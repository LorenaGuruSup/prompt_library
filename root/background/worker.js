const MESSAGE_SCOPE = "promptLibrary";
const STORAGE_KEYS = {
  lists: "lists",
  prompts: "prompts",
  settings: "settings",
  legacy: "promptLibrary",
};
const GENERAL_LIST_ID = "general";
const GENERAL_LIST_NAME = "General";
const SCHEMA_VERSION = 2;

let cachedState = null;

initialize().catch((error) => {
  console.error("No se pudo inicializar el almacenamiento", error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.scope !== MESSAGE_SCOPE) {
    return undefined;
  }

  (async () => {
    try {
      const data = await handleAction(message.action, message.payload);
      sendResponse({ ok: true, data });
    } catch (error) {
      console.error(
        `Error al procesar la acción "${message?.action ?? "desconocida"}"`,
        error,
      );
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      sendResponse({ ok: false, error: errorMessage });
    }
  })();

  return true;
});

async function initialize() {
  const { data, changed } = await loadStateFromStorage();
  if (changed) {
    await writeStateToStorage(data);
  }
  cachedState = cloneState(data);
}

async function handleAction(action, payload = {}) {
  switch (action) {
    case "getState":
      return cloneState(await ensureStateLoaded());
    case "createList":
      return mutateState((draft) => {
        const name =
          typeof payload?.name === "string"
            ? payload.name.trim()
            : "";
        if (!name) {
          throw new Error("El nombre de la lista es obligatorio.");
        }
        const normalizedName = name;
        const exists = draft.lists.some(
          (list) => list.nombre.toLowerCase() === normalizedName.toLowerCase(),
        );
        if (exists) {
          throw new Error("Ya existe una lista con ese nombre.");
        }
        const now = new Date().toISOString();
        const maxOrder = draft.lists.reduce(
          (acc, list) => Math.max(acc, typeof list.orden === "number" ? list.orden : -1),
          -1,
        );
        const newList = {
          id: generateId(),
          nombre: normalizedName,
          creado_en: now,
          actualizado_en: now,
          orden: maxOrder + 1,
        };
        draft.lists.push(newList);
        if (!draft.settings.lista_activa_id) {
          draft.settings.lista_activa_id = newList.id;
        }
      });
    case "setActiveList":
      return mutateState((draft) => {
        const listId =
          typeof payload?.listId === "string"
            ? payload.listId.trim()
            : payload?.listId != null
            ? String(payload.listId).trim()
            : "";
        if (!listId) {
          throw new Error("La lista seleccionada no es válida.");
        }
        const exists = draft.lists.some((list) => list.id === listId);
        if (!exists) {
          throw new Error("La lista seleccionada no existe.");
        }
        draft.settings.lista_activa_id = listId;
      });
    case "createPrompt":
      return mutateState((draft) => {
        const title =
          typeof payload?.title === "string" ? payload.title.trim() : "";
        const content =
          typeof payload?.content === "string" ? payload.content.trim() : "";
        const listIdRaw =
          typeof payload?.listId === "string"
            ? payload.listId.trim()
            : payload?.listId != null
            ? String(payload.listId).trim()
            : draft.settings.lista_activa_id;

        const listId = typeof listIdRaw === "string" ? listIdRaw : "";

        if (!listId) {
          throw new Error("No hay una lista activa seleccionada.");
        }
        if (!content) {
          throw new Error("El contenido del prompt es obligatorio.");
        }
        const exists = draft.lists.some((list) => list.id === listId);
        if (!exists) {
          throw new Error("La lista indicada no existe.");
        }
        const now = new Date().toISOString();
        const newPrompt = {
          id: generateId(),
          lista_id: listId,
          titulo: title,
          cuerpo: content,
          creado_en: now,
          actualizado_en: now,
        };
        draft.prompts.unshift(newPrompt);
        if (!draft.settings.lista_activa_id) {
          draft.settings.lista_activa_id = listId;
        }
        const targetList = draft.lists.find((list) => list.id === listId);
        if (targetList) {
          targetList.actualizado_en = now;
        }
      });
    case "deletePrompt":
      return mutateState((draft) => {
        const promptId =
          typeof payload?.promptId === "string"
            ? payload.promptId.trim()
            : payload?.promptId != null
            ? String(payload.promptId).trim()
            : "";
        if (!promptId) {
          throw new Error("El identificador del prompt es obligatorio.");
        }
        const targetPrompt = draft.prompts.find((prompt) => prompt.id === promptId);
        const before = draft.prompts.length;
        draft.prompts = draft.prompts.filter((prompt) => prompt.id !== promptId);
        if (before === draft.prompts.length) {
          throw new Error("El prompt indicado no existe.");
        }
        if (targetPrompt) {
          const parentList = draft.lists.find(
            (list) => list.id === targetPrompt.lista_id,
          );
          if (parentList) {
            parentList.actualizado_en = new Date().toISOString();
          }
        }
      });
    case "deleteList":
      return mutateState((draft) => {
        const listId =
          typeof payload?.listId === "string"
            ? payload.listId.trim()
            : payload?.listId != null
            ? String(payload.listId).trim()
            : "";
        if (!listId) {
          throw new Error("La lista indicada no es válida.");
        }
        if (listId === GENERAL_LIST_ID) {
          throw new Error("La lista General no se puede eliminar.");
        }
        const targetList = draft.lists.find((list) => list.id === listId);
        if (!targetList) {
          throw new Error("La lista indicada no existe.");
        }
        const destinationListIdRaw =
          typeof payload?.destinationListId === "string"
            ? payload.destinationListId.trim()
            : payload?.destinationListId != null
            ? String(payload.destinationListId).trim()
            : "";
        let destinationListId = "";
        if (destinationListIdRaw) {
          if (destinationListIdRaw === listId) {
            throw new Error("La lista de destino no puede ser la misma.");
          }
          const exists = draft.lists.some(
            (list) => list.id === destinationListIdRaw,
          );
          if (!exists) {
            throw new Error("La lista de destino no existe.");
          }
          destinationListId = destinationListIdRaw;
        }
        if (destinationListId) {
          const reassignedAt = new Date().toISOString();
          draft.prompts = draft.prompts.map((prompt) =>
            prompt.lista_id === listId
              ? { ...prompt, lista_id: destinationListId, actualizado_en: reassignedAt }
              : prompt,
          );
          const destinationList = draft.lists.find(
            (list) => list.id === destinationListId,
          );
          if (destinationList) {
            destinationList.actualizado_en = reassignedAt;
          }
        } else {
          draft.prompts = draft.prompts.filter(
            (prompt) => prompt.lista_id !== listId,
          );
        }
        draft.lists = draft.lists.filter((list) => list.id !== listId);
        if (draft.settings.lista_activa_id === listId) {
          draft.settings.lista_activa_id =
            destinationListId || GENERAL_LIST_ID;
        }
      });
    default:
      throw new Error(`Acción no soportada: ${action}`);
  }
}

async function ensureStateLoaded() {
  if (cachedState) {
    return cachedState;
  }
  const { data, changed } = await loadStateFromStorage();
  if (changed) {
    await writeStateToStorage(data);
  }
  cachedState = cloneState(data);
  return cachedState;
}

async function mutateState(mutator) {
  const current = await ensureStateLoaded();
  const draft = cloneState(current);
  mutator(draft);
  const normalized = normalizeData(draft);
  const hasChanges =
    normalized.changed || !areStatesEqual(current, normalized.data);
  if (hasChanges) {
    await writeStateToStorage(normalized.data);
    cachedState = cloneState(normalized.data);
  }
  return cloneState(cachedState ?? normalized.data);
}

async function loadStateFromStorage() {
  const area = getStorageArea();
  const rawResult = await storageGet(area, [
    STORAGE_KEYS.lists,
    STORAGE_KEYS.prompts,
    STORAGE_KEYS.settings,
    STORAGE_KEYS.legacy,
  ]);

  let rawState = {
    lists: rawResult?.[STORAGE_KEYS.lists],
    prompts: rawResult?.[STORAGE_KEYS.prompts],
    settings: rawResult?.[STORAGE_KEYS.settings],
  };

  let changed = false;

  const hasModernData =
    Array.isArray(rawState.lists) ||
    Array.isArray(rawState.prompts) ||
    (rawState.settings && typeof rawState.settings === "object");

  if (rawResult?.[STORAGE_KEYS.legacy]) {
    const legacy = rawResult[STORAGE_KEYS.legacy];
    if (!hasModernData) {
      rawState = {
        lists: legacy?.lists,
        prompts: legacy?.prompts,
        settings: {
          lista_activa_id: legacy?.lista_activa_id ?? legacy?.activeListId,
        },
      };
    }
    await storageRemove(area, [STORAGE_KEYS.legacy]);
    changed = true;
  }

  const normalized = normalizeData(rawState);
  return {
    data: normalized.data,
    changed: changed || normalized.changed,
  };
}

async function writeStateToStorage(state) {
  const area = getStorageArea();
  await storageSet(area, {
    [STORAGE_KEYS.lists]: state.lists,
    [STORAGE_KEYS.prompts]: state.prompts,
    [STORAGE_KEYS.settings]: state.settings,
  });
}

function normalizeData(rawInput) {
  const result = {
    lists: [],
    prompts: [],
    settings: {
      lista_activa_id: null,
      version: SCHEMA_VERSION,
    },
  };
  let changed = false;

  const now = new Date().toISOString();
  const idMapping = new Map();
  const seenListIds = new Set();
  const rawLists = Array.isArray(rawInput?.lists) ? rawInput.lists : [];
  if (!Array.isArray(rawInput?.lists)) {
    changed = true;
  }

  rawLists.forEach((item, index) => {
    const id = normalizeId(item?.id);
    const rawName =
      typeof item?.nombre === "string"
        ? item.nombre
        : typeof item?.name === "string"
        ? item.name
        : String(item?.nombre ?? item?.name ?? "");
    const nombre = rawName.trim();
    if (!id || !nombre || seenListIds.has(id)) {
      changed = true;
      return;
    }

    const creadoEn = normalizeDate(
      item?.creado_en ?? item?.created_at ?? item?.createdAt,
      now,
    );
    const actualizadoEn = normalizeDate(
      item?.actualizado_en ?? item?.updated_at ?? item?.updatedAt,
      creadoEn,
    );
    const rawOrder = Number(
      item?.orden ?? item?.order ?? index,
    );
    let orden = index;
    if (Number.isFinite(rawOrder)) {
      orden = rawOrder;
    } else {
      changed = true;
    }

    result.lists.push({
      id,
      nombre,
      creado_en: creadoEn,
      actualizado_en: actualizadoEn,
      orden,
    });
    seenListIds.add(id);
  });

  let generalIndex = result.lists.findIndex((list) => list.id === GENERAL_LIST_ID);
  if (generalIndex === -1) {
    generalIndex = result.lists.findIndex(
      (list) => list.nombre.toLowerCase() === GENERAL_LIST_NAME.toLowerCase(),
    );
    if (generalIndex !== -1) {
      const generalList = result.lists[generalIndex];
      if (generalList.id !== GENERAL_LIST_ID) {
        idMapping.set(generalList.id, GENERAL_LIST_ID);
        seenListIds.delete(generalList.id);
        generalList.id = GENERAL_LIST_ID;
        seenListIds.add(GENERAL_LIST_ID);
        changed = true;
      }
      if (generalList.nombre !== GENERAL_LIST_NAME) {
        generalList.nombre = GENERAL_LIST_NAME;
        changed = true;
      }
      result.lists.splice(generalIndex, 1);
      result.lists.unshift(generalList);
    } else {
      result.lists.unshift({
        id: GENERAL_LIST_ID,
        nombre: GENERAL_LIST_NAME,
        creado_en: now,
        actualizado_en: now,
        orden: 0,
      });
      seenListIds.add(GENERAL_LIST_ID);
      changed = true;
    }
  } else if (generalIndex > 0) {
    const [generalList] = result.lists.splice(generalIndex, 1);
    if (generalList.nombre !== GENERAL_LIST_NAME) {
      generalList.nombre = GENERAL_LIST_NAME;
      changed = true;
    }
    result.lists.unshift(generalList);
    changed = true;
  } else {
    const generalList = result.lists[0];
    if (generalList.nombre !== GENERAL_LIST_NAME) {
      generalList.nombre = GENERAL_LIST_NAME;
      changed = true;
    }
  }

  result.lists = result.lists.map((list, index) => {
    if (list.orden !== index) {
      changed = true;
    }
    return {
      ...list,
      orden: index,
    };
  });

  const listIds = new Set(result.lists.map((list) => list.id));

  const rawPrompts = Array.isArray(rawInput?.prompts) ? rawInput.prompts : [];
  if (!Array.isArray(rawInput?.prompts)) {
    changed = true;
  }
  const seenPromptIds = new Set();

  rawPrompts.forEach((item) => {
    const id = normalizeId(item?.id);
    if (!id || seenPromptIds.has(id)) {
      changed = true;
      return;
    }
    seenPromptIds.add(id);

    let listId = normalizeId(item?.lista_id ?? item?.listId);
    if (idMapping.has(listId)) {
      listId = idMapping.get(listId);
      changed = true;
    }
    if (!listId || !listIds.has(listId)) {
      listId = GENERAL_LIST_ID;
      changed = true;
    }

    const tituloRaw =
      typeof item?.titulo === "string"
        ? item.titulo
        : typeof item?.title === "string"
        ? item.title
        : "";
    const titulo = tituloRaw.trim();
    const cuerpoRaw =
      typeof item?.cuerpo === "string"
        ? item.cuerpo
        : typeof item?.content === "string"
        ? item.content
        : String(item?.cuerpo ?? item?.content ?? "");
    const cuerpo = cuerpoRaw.trim();
    if (!cuerpo) {
      changed = true;
      return;
    }

    const creadoEn = normalizeDate(
      item?.creado_en ?? item?.created_at ?? item?.createdAt,
      now,
    );
    const actualizadoEn = normalizeDate(
      item?.actualizado_en ?? item?.updated_at ?? item?.updatedAt,
      creadoEn,
    );

    result.prompts.push({
      id,
      lista_id: listId,
      titulo,
      cuerpo,
      creado_en: creadoEn,
      actualizado_en: actualizadoEn,
    });
  });

  const listaActivaIdRaw =
    rawInput?.settings?.lista_activa_id ??
    rawInput?.settings?.activeListId ??
    rawInput?.lista_activa_id ??
    rawInput?.activeListId ??
    null;
  let listaActivaId = normalizeId(listaActivaIdRaw);
  if (idMapping.has(listaActivaId)) {
    listaActivaId = idMapping.get(listaActivaId);
    changed = true;
  }
  if (!listaActivaId || !listIds.has(listaActivaId)) {
    listaActivaId = result.lists[0]?.id ?? GENERAL_LIST_ID;
    changed = true;
  }

  result.settings = {
    lista_activa_id: listaActivaId,
    version: SCHEMA_VERSION,
  };

  if (rawInput?.settings?.version !== SCHEMA_VERSION) {
    changed = true;
  }

  return { data: result, changed };
}

function normalizeDate(value, fallback) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  } else if (value instanceof Date) {
    return value.toISOString();
  } else if (value != null) {
    const stringified = String(value).trim();
    if (stringified) {
      return stringified;
    }
  }
  return fallback;
}

function normalizeId(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value != null) {
    return String(value).trim();
  }
  return "";
}

function cloneState(source) {
  return {
    lists: Array.isArray(source?.lists)
      ? source.lists.map((list) => ({
          id: list.id,
          nombre: list.nombre,
          creado_en: list.creado_en,
          actualizado_en: list.actualizado_en,
          orden: list.orden,
        }))
      : [],
    prompts: Array.isArray(source?.prompts)
      ? source.prompts.map((prompt) => ({
          id: prompt.id,
          lista_id: prompt.lista_id,
          titulo: prompt.titulo,
          cuerpo: prompt.cuerpo,
          creado_en: prompt.creado_en,
          actualizado_en: prompt.actualizado_en,
        }))
      : [],
    settings: {
      lista_activa_id: source?.settings?.lista_activa_id ?? null,
      version: source?.settings?.version ?? SCHEMA_VERSION,
    },
  };
}

function areStatesEqual(a, b) {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function getStorageArea() {
  if (chrome?.storage?.sync) {
    return chrome.storage.sync;
  }
  return chrome.storage.local;
}

function storageGet(area, keys) {
  return new Promise((resolve, reject) => {
    area.get(keys, (result) => {
      if (chrome.runtime?.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result || {});
    });
  });
}

function storageSet(area, items) {
  return new Promise((resolve, reject) => {
    area.set(items, () => {
      if (chrome.runtime?.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function storageRemove(area, keys) {
  return new Promise((resolve, reject) => {
    area.remove(keys, () => {
      if (chrome.runtime?.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}
