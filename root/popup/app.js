const MESSAGE_SCOPE = "promptLibrary";
const GENERAL_LIST_ID = "general";
const GENERAL_LIST_NAME = "General";
const SCHEMA_VERSION = 1;

const DEFAULT_STATE = Object.freeze({
  lists: [],
  prompts: [],
  settings: Object.freeze({
    activeListId: null,
    version: SCHEMA_VERSION,
  }),
});

const listForm = document.getElementById("listForm");
const listNameInput = document.getElementById("listName");
const activeListSelect = document.getElementById("activeListSelect");
const promptForm = document.getElementById("promptForm");
const promptTitleInput = document.getElementById("promptTitle");
const promptContentInput = document.getElementById("promptContent");
const promptList = document.getElementById("promptList");
const promptEmptyMessage = document.getElementById("promptEmpty");
const promptCount = document.getElementById("promptCount");
const promptFormHelper = document.getElementById("promptFormHelper");

const promptFormFields = promptForm
  ? Array.from(promptForm.querySelectorAll("input, textarea, button"))
  : [];

const feedbackTimers = new WeakMap();

const backgroundClient = (() => {
  if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
    const sendMessage = (action, payload) =>
      new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            { scope: MESSAGE_SCOPE, action, payload },
            (response) => {
              if (chrome.runtime?.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              if (!response) {
                reject(
                  new Error(
                    "Respuesta inválida del servicio en segundo plano.",
                  ),
                );
                return;
              }
              if (response.ok === false) {
                reject(new Error(response.error ?? "Operación rechazada."));
                return;
              }
              resolve(response.data ?? null);
            },
          );
        } catch (error) {
          reject(error);
        }
      });

    return {
      getState() {
        return sendMessage("getState");
      },
      createList(name) {
        return sendMessage("createList", { name });
      },
      setActiveList(listId) {
        return sendMessage("setActiveList", { listId });
      },
      createPrompt({ title, content, listId }) {
        return sendMessage("createPrompt", { title, content, listId });
      },
      deletePrompt(promptId) {
        return sendMessage("deletePrompt", { promptId });
      },
      deleteList(listId, destinationListId) {
        return sendMessage("deleteList", { listId, destinationListId });
      },
    };
  }

  const storage = (() => {
    let fallbackValue = null;
    const hasLocalStorage =
      typeof window !== "undefined" &&
      typeof window.localStorage !== "undefined";

    return {
      async get() {
        if (fallbackValue) {
          return cloneState(fallbackValue);
        }
        if (hasLocalStorage) {
          try {
            const stored = window.localStorage.getItem("promptLibrary");
            if (!stored) {
              return null;
            }
            fallbackValue = JSON.parse(stored);
            return cloneState(fallbackValue);
          } catch (error) {
            console.error("No se pudo leer localStorage", error);
          }
        }
        return fallbackValue ? cloneState(fallbackValue) : null;
      },
      async set(value) {
        fallbackValue = cloneState(value);
        if (hasLocalStorage) {
          try {
            window.localStorage.setItem(
              "promptLibrary",
              JSON.stringify(fallbackValue),
            );
          } catch (error) {
            console.error("No se pudo guardar en localStorage", error);
          }
        }
      },
    };
  })();

  let fallbackState = null;

  async function ensureFallbackState() {
    if (fallbackState) {
      return fallbackState;
    }
    const stored = await storage.get();
    const normalized = normalizeState(stored);
    fallbackState = normalized;
    if (!areStatesEqual(stored, normalized)) {
      await storage.set(normalized);
    }
    return fallbackState;
  }

  async function mutateFallback(mutator) {
    const current = await ensureFallbackState();
    const draft = cloneState(current);
    mutator(draft);
    const normalized = normalizeState(draft);
    if (!areStatesEqual(current, normalized)) {
      await storage.set(normalized);
      fallbackState = normalized;
    }
    return cloneState(fallbackState ?? normalized);
  }

  return {
    async getState() {
      const current = await ensureFallbackState();
      return cloneState(current);
    },
    async createList(name) {
      return mutateFallback((draft) => {
        const trimmed = typeof name === "string" ? name.trim() : "";
        if (!trimmed) {
          throw new Error("El nombre de la lista es obligatorio.");
        }
        const exists = draft.lists.some(
          (list) => list.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (exists) {
          throw new Error("Ya existe una lista con ese nombre.");
        }
        const newList = { id: generateId(), name: trimmed };
        draft.lists.push(newList);
        if (!draft.settings.activeListId) {
          draft.settings.activeListId = newList.id;
        }
      });
    },
    async setActiveList(listId) {
      return mutateFallback((draft) => {
        const normalizedId =
          typeof listId === "string"
            ? listId.trim()
            : String(listId ?? "").trim();
        if (!normalizedId) {
          throw new Error("La lista seleccionada no es válida.");
        }
        const exists = draft.lists.some((list) => list.id === normalizedId);
        if (!exists) {
          throw new Error("La lista seleccionada no existe.");
        }
        draft.settings.activeListId = normalizedId;
      });
    },
    async createPrompt({ title, content, listId }) {
      return mutateFallback((draft) => {
        const normalizedContent =
          typeof content === "string" ? content.trim() : "";
        const normalizedTitle =
          typeof title === "string" ? title.trim() : "";
        const normalizedListId =
          typeof listId === "string" && listId.trim()
            ? listId.trim()
            : draft.settings.activeListId;
        if (!normalizedListId) {
          throw new Error("No hay una lista activa seleccionada.");
        }
        if (!normalizedContent) {
          throw new Error("El contenido del prompt es obligatorio.");
        }
        const exists = draft.lists.some((list) => list.id === normalizedListId);
        if (!exists) {
          throw new Error("La lista indicada no existe.");
        }
        draft.prompts.unshift({
          id: generateId(),
          listId: normalizedListId,
          title: normalizedTitle,
          content: normalizedContent,
        });
      });
    },
    async deletePrompt(promptId) {
      return mutateFallback((draft) => {
        const normalizedId =
          typeof promptId === "string"
            ? promptId.trim()
            : String(promptId ?? "").trim();
        if (!normalizedId) {
          throw new Error("El identificador del prompt es obligatorio.");
        }
        const before = draft.prompts.length;
        draft.prompts = draft.prompts.filter(
          (prompt) => prompt.id !== normalizedId,
        );
        if (before === draft.prompts.length) {
          throw new Error("El prompt indicado no existe.");
        }
      });
    },
    async deleteList(listId, destinationListId) {
      return mutateFallback((draft) => {
        const normalizedId =
          typeof listId === "string"
            ? listId.trim()
            : String(listId ?? "").trim();
        if (!normalizedId) {
          throw new Error("La lista indicada no es válida.");
        }
        if (normalizedId === GENERAL_LIST_ID) {
          throw new Error("La lista General no se puede eliminar.");
        }
        const exists = draft.lists.some((list) => list.id === normalizedId);
        if (!exists) {
          throw new Error("La lista indicada no existe.");
        }
        let destinationId = "";
        if (destinationListId) {
          destinationId =
            typeof destinationListId === "string"
              ? destinationListId.trim()
              : String(destinationListId ?? "").trim();
          if (destinationId === normalizedId) {
            throw new Error("La lista de destino no puede ser la misma.");
          }
          const destinationExists = draft.lists.some(
            (list) => list.id === destinationId,
          );
          if (!destinationExists) {
            throw new Error("La lista de destino no existe.");
          }
        }
        if (destinationId) {
          draft.prompts = draft.prompts.map((prompt) =>
            prompt.listId === normalizedId
              ? { ...prompt, listId: destinationId }
              : prompt,
          );
        } else {
          draft.prompts = draft.prompts.filter(
            (prompt) => prompt.listId !== normalizedId,
          );
        }
        draft.lists = draft.lists.filter((list) => list.id !== normalizedId);
        if (draft.settings.activeListId === normalizedId) {
          draft.settings.activeListId = destinationId || GENERAL_LIST_ID;
        }
      });
    },
  };
})();

let state = normalizeState(DEFAULT_STATE);

init().catch((error) => {
  console.error("No se pudo inicializar la biblioteca de prompts", error);
});

async function init() {
  render();
  attachEventListeners();
  try {
    const storedState = await backgroundClient.getState();
    state = normalizeState(storedState);
  } catch (error) {
    console.error("No se pudo cargar el estado almacenado", error);
    state = normalizeState(state);
  }
  render();
}

function attachEventListeners() {
  if (listForm) {
    listForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = listNameInput?.value.trim();
      if (!name) {
        return;
      }
      try {
        const newState = await backgroundClient.createList(name);
        state = normalizeState(newState);
        render();
        if (listForm) {
          listForm.reset();
        }
        listNameInput?.focus();
      } catch (error) {
        console.error("No se pudo crear la lista", error);
      }
    });
  }

  if (activeListSelect) {
    activeListSelect.addEventListener("change", async (event) => {
      const selectedId = event.target.value;
      if (!selectedId || selectedId === state.settings.activeListId) {
        return;
      }
      try {
        const newState = await backgroundClient.setActiveList(selectedId);
        state = normalizeState(newState);
        render();
      } catch (error) {
        console.error("No se pudo cambiar la lista activa", error);
        activeListSelect.value = state.settings.activeListId ?? "";
      }
    });
  }

  if (promptForm) {
    promptForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const activeListId = state.settings.activeListId;
      if (!activeListId) {
        return;
      }
      const title = promptTitleInput?.value.trim();
      const content = promptContentInput?.value.trim();
      if (!title || !content) {
        return;
      }
      try {
        const newState = await backgroundClient.createPrompt({
          title,
          content,
          listId: activeListId,
        });
        state = normalizeState(newState);
        render();
        if (promptForm) {
          promptForm.reset();
        }
        promptTitleInput?.focus();
      } catch (error) {
        console.error("No se pudo crear el prompt", error);
      }
    });
  }
}

function render() {
  renderListSelector();
  renderPromptForm();
  renderPromptCards();
}

function renderListSelector() {
  if (!activeListSelect) {
    return;
  }
  activeListSelect.innerHTML = "";
  if (state.lists.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Sin listas disponibles";
    option.disabled = true;
    option.selected = true;
    activeListSelect.append(option);
    activeListSelect.disabled = true;
  } else {
    activeListSelect.disabled = false;
    state.lists.forEach((list) => {
      const option = document.createElement("option");
      option.value = list.id;
      option.textContent = list.name;
      option.selected = list.id === state.settings.activeListId;
      activeListSelect.append(option);
    });
  }
}

function renderPromptForm() {
  const activeListId = state.settings.activeListId;
  const hasActiveList = Boolean(activeListId);
  promptFormFields.forEach((field) => {
    field.disabled = !hasActiveList;
  });
  if (promptFormHelper) {
    if (hasActiveList) {
      const activeList = state.lists.find((list) => list.id === activeListId);
      const listName = activeList?.name ?? "";
      promptFormHelper.textContent =
        listName.trim().length > 0
          ? `El prompt se guardará en «${listName}».`
          : "El prompt se guardará en la lista seleccionada.";
    } else {
      promptFormHelper.textContent =
        "Selecciona o crea una lista activa para guardar un nuevo prompt.";
    }
  }
}

function renderPromptCards() {
  if (!promptList || !promptEmptyMessage || !promptCount) {
    return;
  }

  promptList.innerHTML = "";
  const activeListId = state.settings.activeListId;
  const activePrompts = activeListId
    ? state.prompts.filter((prompt) => prompt.listId === activeListId)
    : [];

  if (state.lists.length === 0) {
    promptEmptyMessage.hidden = false;
    promptEmptyMessage.textContent =
      "Crea una lista para comenzar a guardar tus prompts.";
  } else if (activePrompts.length === 0) {
    promptEmptyMessage.hidden = false;
    promptEmptyMessage.textContent = "Todavía no hay prompts en esta lista.";
  } else {
    promptEmptyMessage.hidden = true;
  }

  activePrompts.forEach((prompt) => {
    promptList.append(createPromptCard(prompt));
  });

  promptCount.textContent = String(activePrompts.length);
}

function createPromptCard(prompt) {
  const article = document.createElement("article");
  article.className = "prompt-card";
  article.setAttribute("role", "listitem");

  const title = document.createElement("h3");
  title.className = "prompt-card__title";
  title.textContent = prompt.title || "Sin título";

  const content = document.createElement("p");
  content.className = "prompt-card__content";
  content.textContent = prompt.content;

  const actions = document.createElement("div");
  actions.className = "prompt-card__actions";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "prompt-card__button";
  copyButton.textContent = "Copiar";
  copyButton.addEventListener("click", async () => {
    const copied = await copyToClipboard(prompt.content);
    setButtonFeedback(copyButton, copied ? "Copiado" : "Error");
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "prompt-card__button prompt-card__button--danger";
  deleteButton.textContent = "Eliminar";
  deleteButton.addEventListener("click", async () => {
    try {
      const newState = await backgroundClient.deletePrompt(prompt.id);
      state = normalizeState(newState);
      render();
    } catch (error) {
      console.error("No se pudo eliminar el prompt", error);
    }
  });

  actions.append(copyButton, deleteButton);
  article.append(title, content, actions);
  return article;
}

async function copyToClipboard(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error("No se pudo copiar el texto", error);
    }
  }

  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "absolute";
  fallback.style.left = "-9999px";
  document.body.appendChild(fallback);
  fallback.select();

  let success = false;
  try {
    success = document.execCommand("copy");
  } catch (error) {
    console.error("El método de copia alternativo falló", error);
  }
  fallback.remove();
  return success;
}

function setButtonFeedback(button, message) {
  if (!button) {
    return;
  }
  if (feedbackTimers.has(button)) {
    clearTimeout(feedbackTimers.get(button));
  }
  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = button.textContent;
  }
  button.dataset.feedback = "true";
  button.textContent = message;
  const timer = setTimeout(() => {
    button.dataset.feedback = "false";
    button.textContent = button.dataset.originalLabel ?? "";
  }, 1500);
  feedbackTimers.set(button, timer);
}

function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneState(source) {
  const activeListIdValue =
    source?.settings?.activeListId ?? source?.activeListId ?? null;
  return {
    lists: Array.isArray(source?.lists)
      ? source.lists.map((list) => ({ id: list.id, name: list.name }))
      : [],
    prompts: Array.isArray(source?.prompts)
      ? source.prompts.map((prompt) => ({
          id: prompt.id,
          listId: prompt.listId,
          title: prompt.title,
          content: prompt.content,
        }))
      : [],
    settings: {
      activeListId: activeListIdValue,
      version: source?.settings?.version ?? SCHEMA_VERSION,
    },
  };
}

function normalizeState(rawState) {
  const source = rawState ?? {};

  const idMapping = new Map();
  const seenListIds = new Set();
  const lists = [];
  const rawLists = Array.isArray(source.lists) ? source.lists : [];
  rawLists.forEach((item) => {
    const id = normalizeId(item?.id);
    const name =
      typeof item?.name === "string" ? item.name.trim() : String(item?.name ?? "").trim();
    if (!id || !name || seenListIds.has(id)) {
      return;
    }
    lists.push({ id, name });
    seenListIds.add(id);
  });

  let generalIndex = lists.findIndex((list) => list.id === GENERAL_LIST_ID);
  if (generalIndex === -1) {
    generalIndex = lists.findIndex(
      (list) => list.name.toLowerCase() === GENERAL_LIST_NAME.toLowerCase(),
    );
    if (generalIndex !== -1) {
      const generalList = lists.splice(generalIndex, 1)[0];
      if (generalList.id !== GENERAL_LIST_ID) {
        idMapping.set(generalList.id, GENERAL_LIST_ID);
        generalList.id = GENERAL_LIST_ID;
      }
      generalList.name = GENERAL_LIST_NAME;
      lists.unshift(generalList);
    } else {
      lists.unshift({ id: GENERAL_LIST_ID, name: GENERAL_LIST_NAME });
    }
  } else {
    const generalList = lists[generalIndex];
    if (generalIndex > 0) {
      lists.splice(generalIndex, 1);
      lists.unshift(generalList);
    }
    if (generalList.name !== GENERAL_LIST_NAME) {
      generalList.name = GENERAL_LIST_NAME;
    }
  }

  const listIds = new Set(lists.map((list) => list.id));

  const prompts = [];
  const seenPromptIds = new Set();
  const rawPrompts = Array.isArray(source.prompts) ? source.prompts : [];
  rawPrompts.forEach((item) => {
    const id = normalizeId(item?.id);
    if (!id || seenPromptIds.has(id)) {
      return;
    }
    seenPromptIds.add(id);

    let listId = normalizeId(item?.listId);
    if (idMapping.has(listId)) {
      listId = idMapping.get(listId);
    }
    if (!listId || !listIds.has(listId)) {
      listId = GENERAL_LIST_ID;
    }

    const title =
      typeof item?.title === "string" ? item.title.trim() : "";
    const content =
      typeof item?.content === "string"
        ? item.content.trim()
        : String(item?.content ?? "").trim();
    if (!content) {
      return;
    }

    prompts.push({ id, listId, title, content });
  });

  const activeListIdRaw =
    source?.settings?.activeListId ?? source?.activeListId ?? null;
  let activeListId = normalizeId(activeListIdRaw);
  if (idMapping.has(activeListId)) {
    activeListId = idMapping.get(activeListId);
  }
  if (!activeListId || !listIds.has(activeListId)) {
    activeListId = lists[0]?.id ?? GENERAL_LIST_ID;
  }

  return {
    lists,
    prompts,
    settings: {
      activeListId,
      version: SCHEMA_VERSION,
    },
  };
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

function areStatesEqual(a, b) {
  const first = a ?? DEFAULT_STATE;
  const second = b ?? DEFAULT_STATE;
  return JSON.stringify(first) === JSON.stringify(second);
}
