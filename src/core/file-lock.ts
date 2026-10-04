import fs from "fs";
import { DesignError } from "./node-factory.js";

/** Au-delà de ce délai, un verrou est réputé abandonné (processus tué en cours d'écriture). */
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

/**
 * Pause bloquante. Les stores sont entièrement synchrones — les rendre
 * asynchrones pour l'attente d'un verrou contaminerait tous les appelants.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Sérialise un cycle lire-modifier-écrire entre processus. `wx` échoue si le
 * fichier de verrou existe déjà : c'est l'opération atomique qui départage deux
 * écrivains concurrents. Non réentrant — ne jamais appeler depuis `fn`.
 *
 * `subject` nomme la ressource dans le message d'erreur, p.ex. `Design "landing"`.
 */
export function withFileLock<T>(lockPath: string, subject: string, fn: () => T): T {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd: number;

  for (;;) {
    try {
      fd = fs.openSync(lockPath, "wx");
      break;
    } catch (err: any) {
      if (err.code !== "EEXIST") throw err;
      try {
        // Un processus tué laisse son verrou derrière lui : passé le délai
        // d'obsolescence on le casse, sinon la ressource serait bloquée à vie.
        if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue; // Verrou disparu entre le open et le stat : on retente aussitôt.
      }
      if (Date.now() > deadline) {
        throw new DesignError(
          `${subject} is being written by another editor and did not free up in ${LOCK_TIMEOUT_MS} ms. Try again in a moment.`
        );
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }

  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Verrou déjà cassé pour obsolescence par un autre processus.
    }
  }
}
