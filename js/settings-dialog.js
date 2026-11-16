function connectMetricsSettings({ trigger, dialog, begin, accept, discard, applied }) {
  let editing = false;

  function cancel() {
    if (!editing) return;
    editing = false;
    discard?.();
  }

  trigger.onclick = () => {
    if (dialog.open) return;
    begin();
    editing = true;
    dialog.showModal();
  };
  for (const button of dialog.querySelectorAll("[data-dismiss]")) {
    button.onclick = () => {
      cancel();
      dialog.close();
    };
  }
  dialog.querySelector("[data-confirm]").onclick = () => {
    if (!editing || accept() === false) return;
    editing = false;
    dialog.close();
    applied?.();
  };
  dialog.addEventListener("cancel", cancel);
  dialog.addEventListener("close", () => { if (!dialog.open) cancel(); });
}
