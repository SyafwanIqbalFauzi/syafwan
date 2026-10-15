// Small modal dialogs for the /agent pages, replacing the browser's alert/confirm/prompt.
// Built on the native <dialog>, so focus trapping, the Escape key and the dimmed backdrop come
// from the browser. Look: see ".dlg" in styles/hermes.css.

interface Base {
  title: string;
  message?: string;
  confirm?: string;
  cancel?: string;
  /** Red confirm button, and the safe choice (cancel) gets the focus. */
  danger?: boolean;
}

interface TextOptions extends Base {
  label: string;
  value?: string;
  maxLength?: number;
  placeholder?: string;
  /** Return an error message to refuse the value, or null to accept it. */
  validate?: (value: string) => string | null;
}

function build(options: Base, field?: TextOptions) {
  const dialog = document.createElement('dialog');
  dialog.className = 'dlg';
  dialog.setAttribute('aria-labelledby', 'dlg-title');

  const form = document.createElement('form');
  form.method = 'dialog';

  const heading = document.createElement('h2');
  heading.id = 'dlg-title';
  heading.textContent = options.title;
  form.append(heading);

  if (options.message) {
    const message = document.createElement('p');
    message.className = 'dlg-message';
    message.textContent = options.message;
    form.append(message);
  }

  let input: HTMLInputElement | undefined;
  let error: HTMLElement | undefined;
  if (field) {
    const label = document.createElement('label');
    label.className = 'dlg-field';
    const caption = document.createElement('span');
    caption.className = 'label muted';
    caption.textContent = field.label;
    input = document.createElement('input');
    input.type = 'text';
    input.value = field.value ?? '';
    input.maxLength = field.maxLength ?? 120;
    input.autocomplete = 'off';
    if (field.placeholder) input.placeholder = field.placeholder;
    error = document.createElement('span');
    error.className = 'dlg-error';
    error.setAttribute('role', 'alert');
    label.append(caption, input, error);
    form.append(label);
  }

  const actions = document.createElement('div');
  actions.className = 'dlg-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = options.cancel ?? 'Cancel';
  const confirm = document.createElement('button');
  confirm.type = 'submit';
  confirm.className = options.danger ? 'btn btn-solid btn-danger' : 'btn btn-solid';
  confirm.textContent = options.confirm ?? 'OK';
  actions.append(cancel, confirm);
  form.append(actions);
  dialog.append(form);
  return { dialog, form, input, error, cancel, confirm };
}

function run<T>(options: Base, field: TextOptions | undefined, pick: (value: string | undefined) => T, none: T): Promise<T> {
  return new Promise((resolve) => {
    const { dialog, form, input, error, cancel, confirm } = build(options, field);
    let result: T = none;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (input && field) {
        const problem = field.validate?.(input.value) ?? null;
        if (problem) {
          if (error) error.textContent = problem;
          input.focus();
          return;
        }
      }
      result = pick(input?.value);
      dialog.close();
    });
    input?.addEventListener('input', () => {
      if (error) error.textContent = '';
    });
    cancel.addEventListener('click', () => dialog.close());
    // A click on the dimmed backdrop (the dialog element itself, not its content) cancels.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });

    document.body.append(dialog);
    dialog.showModal();
    if (input) {
      input.focus();
      input.select();
    } else (options.danger ? cancel : confirm).focus();
  });
}

/** Resolves true when confirmed; false on cancel, Escape or a click outside. */
export function askConfirm(options: Base): Promise<boolean> {
  return run(options, undefined, () => true, false);
}

/** Resolves to the entered text, or null on cancel. */
export function askText(options: TextOptions): Promise<string | null> {
  return run(options, options, (value) => value ?? '', null);
}
