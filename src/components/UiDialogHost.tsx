import { useEffect, useRef, useState } from "react";
import { useUiDialogStore } from "../stores/uiDialog";

/**
 * Renders the in-app replacement for window.confirm/alert/prompt (see
 * src/stores/uiDialog.ts for why native dialogs can't be used here). Mount
 * once near the root of the Studio view.
 */
export function UiDialogHost() {
   const request = useUiDialogStore((s) => s.request);
   const clear = useUiDialogStore((s) => s.clear);
   const [value, setValue] = useState("");
   const inputRef = useRef<HTMLInputElement>(null);

   useEffect(() => {
      if (request?.kind === "prompt") {
         setValue(request.defaultValue);
         setTimeout(() => inputRef.current?.select(), 0);
      }
   }, [request]);

   if (!request) return null;

   const respondConfirm = (ok: boolean) => {
      if (request.kind === "confirm") request.resolve(ok);
      clear();
   };
   const respondAlert = () => {
      if (request.kind === "alert") request.resolve();
      clear();
   };
   const respondPrompt = (v: string | null) => {
      if (request.kind === "prompt") request.resolve(v);
      clear();
   };

   const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
         if (request.kind === "confirm") respondConfirm(false);
         else if (request.kind === "alert") respondAlert();
         else respondPrompt(null);
      } else if (e.key === "Enter" && request.kind === "prompt") {
         respondPrompt(value);
      }
   };

   return (
      <div
         className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200]"
         data-testid="ui-dialog-host"
         onKeyDown={handleKeyDown}
      >
         <div className="bg-studio-panel rounded-lg border border-studio-border shadow-2xl max-w-sm w-full mx-4 p-5">
            <p className="text-sm text-studio-text whitespace-pre-line mb-4" data-testid="ui-dialog-message">
               {request.message}
            </p>

            {request.kind === "prompt" && (
               <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  data-testid="ui-dialog-input"
                  autoFocus
                  className="w-full mb-4 px-3 py-1.5 bg-studio-canvas border border-studio-border border border-studio-border rounded text-sm focus:outline-none focus:border-studio-accent"
               />
            )}

            <div className="flex justify-end gap-2">
               {request.kind === "alert" ? (
                  <button
                     onClick={respondAlert}
                     autoFocus
                     data-testid="ui-dialog-ok"
                     className="px-4 py-1.5 rounded bg-studio-accent hover:brightness-110 text-sm font-medium transition"
                  >
                     OK
                  </button>
               ) : (
                  <>
                     <button
                        onClick={() => (request.kind === "prompt" ? respondPrompt(null) : respondConfirm(false))}
                        data-testid="ui-dialog-cancel"
                        className="px-4 py-1.5 rounded bg-studio-canvas border border-studio-border hover:bg-white/10 text-sm transition"
                     >
                        Cancel
                     </button>
                     <button
                        onClick={() => (request.kind === "prompt" ? respondPrompt(value) : respondConfirm(true))}
                        autoFocus
                        data-testid="ui-dialog-ok"
                        className="px-4 py-1.5 rounded bg-studio-accent hover:brightness-110 text-sm font-medium transition"
                     >
                        OK
                     </button>
                  </>
               )}
            </div>
         </div>
      </div>
   );
}
