const DEFAULT_STATE = Object.freeze({
  lists: [],
  prompts: [],
  activeListId: null,
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

const storageAdapter = (() => {
  if (typeof chrome !== "undefined" && chrome?.storage) {
    const area = chrome.storage.sync ?? chrome.storage.local;
    return {
      async get() {
        return new Promise((resolve) => {
          area.get(["promptLibrary"], (result) => {
            if (chrome.runtime?.lastError) {
              console.error(
                "No se pudo leer el almacenamiento",
                chrome.runtime.lastError,
              );
              resolve(null);
              return;
            }
            resolve(result?.promptLibrary ?? null);
          });
        });
      },
      async set(value) {
        return new Promise((resolve) => {
          area.set({ promptLibrary: value }, () => {
            if (chrome.runtime?.lastError) {
              console.error(
                "No se pudo guardar en el almacenamiento",
                chrome.runtime.lastError,
              );
            }
            resolve();
          });
        });
      },
    };
  }

  let fallbackValue = null;
  const hasLocalStorage =
    typeof window !== "undefined" && typeof window.localStorage !== "undefined";

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

let state = cloneState(DEFAULT_STATE);

init().catch((error) => {
  console.error("No se pudo inicializar la biblioteca de prompts", error);
});

async function init() {
  render();
  attachEventListeners();
  const storedState = await storageAdapter.get();
  const normalizedState = normalizeState(storedState);
  state = normalizedState;
  if (!areStatesEqual(storedState, normalizedState)) {
    await storageAdapter.set(normalizedState);
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
      await updateState((draft) => {
        const newList = { id: generateId(), name };
        draft.lists.push(newList);
        if (!draft.activeListId) {
          draft.activeListId = newList.id;
        }
      });
      if (listForm) {
        listForm.reset();
      }
      listNameInput?.focus();
    });
  }

  if (activeListSelect) {
    activeListSelect.addEventListener("change", async (event) => {
      const selectedId = event.target.value;
      if (!selectedId || selectedId === state.activeListId) {
        return;
      }
      await updateState((draft) => {
        if (draft.lists.some((list) => list.id === selectedId)) {
          draft.activeListId = selectedId;
        }
      });
    });
  }

  if (promptForm) {
    promptForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.activeListId) {
        return;
      }
      const title = promptTitleInput?.value.trim();
      const content = promptContentInput?.value.trim();
      if (!title || !content) {
        return;
      }
      await updateState((draft) => {
        draft.prompts.unshift({
          id: generateId(),
          listId: draft.activeListId,
          title,
          content,
        });
      });
      if (promptForm) {
        promptForm.reset();
      }
      promptTitleInput?.focus();
    });
  }
}

async function updateState(mutator) {
  try {
    const draft = cloneState(state);
    mutator(draft);
    const normalized = normalizeState(draft);
    await storageAdapter.set(normalized);
    state = normalized;
    render();
  } catch (error) {
    console.error("No se pudo actualizar el estado", error);
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
      option.selected = list.id === state.activeListId;
      activeListSelect.append(option);
    });
  }
}

function renderPromptForm() {
  const hasActiveList = Boolean(state.activeListId);
  promptFormFields.forEach((field) => {
    field.disabled = !hasActiveList;
  });
  if (promptFormHelper) {
    if (hasActiveList) {
      const activeList = state.lists.find(
        (list) => list.id === state.activeListId,
      );
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
  const activePrompts = state.activeListId
    ? state.prompts.filter((prompt) => prompt.listId === state.activeListId)
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
    await updateState((draft) => {
      draft.prompts = draft.prompts.filter((item) => item.id !== prompt.id);
    });
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
  return {
    lists: Array.isArray(source?.lists)
      ? source.lists.map((list) => ({
          id: list.id,
          name: list.name,
        }))
      : [],
    prompts: Array.isArray(source?.prompts)
      ? source.prompts.map((prompt) => ({
          id: prompt.id,
          listId: prompt.listId,
          title: prompt.title,
          content: prompt.content,
        }))
      : [],
    activeListId: source?.activeListId ?? null,
  };
}

function normalizeState(rawState) {
  if (!rawState) {
    return cloneState(DEFAULT_STATE);
  }

  const listIds = new Set();
  const lists = Array.isArray(rawState.lists)
    ? rawState.lists.reduce((acc, item) => {
        const idValue =
          typeof item?.id === "string"
            ? item.id.trim()
            : item?.id != null
            ? String(item.id)
            : "";
        const nameValue =
          typeof item?.name === "string" ? item.name.trim() : "";
        if (!idValue || !nameValue || listIds.has(idValue)) {
          return acc;
        }
        listIds.add(idValue);
        acc.push({ id: idValue, name: nameValue });
        return acc;
      }, [])
    : [];

  const prompts = Array.isArray(rawState.prompts)
    ? rawState.prompts.reduce((acc, item) => {
        const idValue =
          typeof item?.id === "string"
            ? item.id.trim()
            : item?.id != null
            ? String(item.id)
            : "";
        const listIdValue =
          typeof item?.listId === "string"
            ? item.listId.trim()
            : item?.listId != null
            ? String(item.listId)
            : "";
        const titleValue =
          typeof item?.title === "string" ? item.title.trim() : "";
        const contentValue =
          typeof item?.content === "string" ? item.content.trim() : "";
        if (
          !idValue ||
          !listIdValue ||
          !contentValue ||
          !listIds.has(listIdValue)
        ) {
          return acc;
        }
        acc.push({
          id: idValue,
          listId: listIdValue,
          title: titleValue,
          content: contentValue,
        });
        return acc;
      }, [])
    : [];

  let activeListId =
    typeof rawState.activeListId === "string"
      ? rawState.activeListId
      : rawState.activeListId != null
      ? String(rawState.activeListId)
      : null;
  if (!activeListId || !listIds.has(activeListId)) {
    activeListId = lists[0]?.id ?? null;
  }

  return {
    lists,
    prompts,
    activeListId,
  };
}

function areStatesEqual(a, b) {
  const first = a ?? DEFAULT_STATE;
  const second = b ?? DEFAULT_STATE;
  return JSON.stringify(first) === JSON.stringify(second);
}
