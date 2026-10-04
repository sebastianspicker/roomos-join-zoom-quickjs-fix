/**
 * Author und Project-Lead:   Zacharie Gignac
 * Co-Author und Tester:      Robert McGonigle
 * Update 2025:				  Sebastian J. Spicker
 *
 * CIFSS – Université Laval
 * Harvard University IT
 * Cologne University of Music
 *
 * Released:  November 2020
 * Updated:   Mai 2025  (RoomOS 11.28-Fix)
 *
 * Beschreibung:
 *   Asynchrones Lesen/Schreiben permanenter Daten über das Macro-Subsystem
 *   Für Details siehe:
 *   https://github.com/Bobby-McGonigle/Cisco-RoomDevice-Macro-Projects-Examples/tree/master/Macro%20Memory%20Storage
 */

/* ------------------------------------------------------------------ */
/*  0)   BASIS-IMPORTS UND KONFIGURATION                               */
/* ------------------------------------------------------------------ */
import xapi from 'xapi';

const config = {
  storageMacro: 'Memory_Storage',     // Name des Storage-Macros
  autoImport: {
    mode: 'false',                    // true | false | "activeOnly" | "custom" | "customActive"
    customImport: []                  // nur bei "custom*" benutzt
  }
};

/* ------------------------------------------------------------------ */
/*  1)   MEM-OBJEKT INITIALISIEREN                                    */
/* ------------------------------------------------------------------ */
const mem = {};                 // **globale zentrale Ablage** für alle Funktionen

/* ------------------------------------------------------------------ */
/*  2)   PATCH: localScript-Namen FESTLEGEN (RoomOS ≥ 11.28)          */
/* ------------------------------------------------------------------ */
function localScriptNameFrom({ importMetaUrl, moduleName, fallbackName }) {
  if (importMetaUrl) {
    const lastPathSegment = String(importMetaUrl).split('/').pop();
    if (lastPathSegment) {
      return lastPathSegment.replace(/\.js$/i, '');
    }
  }

  if (moduleName) return String(moduleName);

  return fallbackName || 'UnknownScript';
}

(function applyLocalScriptName() {
  const importMetaUrl = (typeof import.meta !== 'undefined' && import.meta.url)
    ? import.meta.url
    : undefined;

  const moduleName = (typeof module !== 'undefined' && module.name)
    ? module.name
    : undefined;

  mem.localScript = localScriptNameFrom({
    importMetaUrl,
    moduleName,
    fallbackName: 'Memory_Functions'
  });
})();

/**
 * Robust JSON extraction from macro content.
 * Finds the first '{' and the last '}'.
 */
function parseStoreFromMacroContent(content) {
  const c = String(content || '');
  const start = c.indexOf('{');
  const end = c.lastIndexOf('}');

  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Memory store parse error: No valid JSON object found.');
  }

  const jsonText = c.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Memory store parse error: ${e.message}`, { cause: e });
  }
}

function getStore() {
  return xapi.Command.Macros.Macro.Get({ Content: 'True', Name: config.storageMacro })
    .then((e) => {
      if (!e?.Macro || !Array.isArray(e.Macro) || e.Macro.length === 0 || !e.Macro[0]?.Content) {
        return Promise.reject(new Error('Memory store: macro content missing or empty.'));
      }
      return parseStoreFromMacroContent(e.Macro[0].Content);
    });
}

function saveStore(store) {
  return xapi.Command.Macros.Macro.Save(
    { Name: config.storageMacro },
    `var memory = ${JSON.stringify(store, null, 4)};`
  );
}

/* ------------------------------------------------------------------ */
/*  2.1) QUEUE: serialisiert alle Read-Modify-Write-Zugriffe          */
/* ------------------------------------------------------------------ */
let queue = Promise.resolve();

function enqueue(op) {
  const run = queue.then(op);
  queue = run.catch(() => {});      // fehlgeschlagene Operation blockiert nichts
  return run;
}

/* ------------------------------------------------------------------ */
/*  3)   INITIALISIERUNG DES STORAGE-MACROS                           */
/* ------------------------------------------------------------------ */
function memoryInit() {
  /*  Alle Macros auflisten; nur wenn das Storage-Macro fehlt, anlegen.
      Schlägt die Auflistung fehl, wird der Fehler weitergereicht, damit
      vorhandene Daten nie überschrieben werden.  */
  return xapi.Command.Macros.Macro.Get({})
    .then((list) => {
      const exists = Array.isArray(list?.Macro) &&
        list.Macro.some((m) => m?.Name === config.storageMacro);
      if (exists) return undefined;          // vorhanden → fertig

      return enqueue(() => {                 // nicht vorhanden → anlegen
        console.warn(`No storage macro found, creating "${config.storageMacro}" ...`);

        const initialContent =
          `var memory = {
    "./_$Info": {
        "Warning": "Do NOT modify this document, as other Scripts/Macros may rely on this information",
        "AvailableFunctions": {
            "local": [
                "mem.read('key')",
                "mem.write('key', 'value')",
                "mem.remove('key')",
                "mem.print()"
            ],
            "global": [
                "mem.read.global('key')",
                "mem.write.global('key', 'value')",
                "mem.remove.global('key')",
                "mem.print.global()"
            ]
        },
        "Guide": "https://github.com/Bobby-McGonigle/Cisco-RoomDevice-Macro-Projects-Examples/tree/master/Macro%20Memory%20Storage"
    },
    "ExampleKey": "Example Value"
}`;

        return xapi.Command.Macros.Macro.Save({ Name: config.storageMacro }, initialContent)
          .then(() => getStore())
          .then((store) => {
            console.log(store);
            return store;
          });
      }).then(() => undefined);
    });
}

/* ------------------------------------------------------------------ */
/*  4)   AUTO-IMPORT-UNTERSTÜTZUNG                                    */
/* ------------------------------------------------------------------ */

/*  Bausteine, die in andere Makros eingefügt werden, falls dort xapi/mem
    noch nicht importiert sind.  Die Zuweisung von localScript nutzt
    **bereits** den neuen ES-Modul-Ansatz und ist damit zukunftssicher.
    Fehlen alle drei, ergibt sich genau das bisherige Import-Template.   */
const importXapiLine = `import xapi from 'xapi';\n`;
const importMemLine = `import { mem } from './Memory_Functions';\n`;
const localScriptBlock = `
mem.localScript = (typeof import.meta !== 'undefined' && import.meta.url)
  ? import.meta.url.split('/').pop().replace(/\\.js$/i, '')      // QuickJS / ES Modules
  : (typeof module !== 'undefined' && module.name)              // legacy Duktape
  || 'UnknownScript';                                           // final fallback

`;

/*  Erkennung bewusst großzügig (überall im Text, auch `import xapi, {…}`,
    `* as xapi`, doppelte Anführungszeichen, `{ mem, … }`): lieber einen
    Import nicht ergänzen als eine doppelte Bindung erzeugen, die das
    Makro unlesbar macht.  */
const xapiImportRegex = /import\s+[^;'"]*\bxapi\b[^;'"]*\bfrom\s*(['"])xapi\1/;
const memImportRegex = /import\s*{[^}]*\bmem\b[^}]*}\s*from\s*(['"])\.\/Memory_Functions\1/;
const localScriptRegex = /mem\.localScript\s*=/;

/*  Einfügepunkt nur hinter einem xapi-Import ganz am Anfang (davor nur
    Leerraum, danach höchstens `;` und ein //-Kommentar), sonst ganz oben –
    beides liegt sicher außerhalb von Kommentaren und Strings.  */
const leadingXapiImportRegex =
  /^\s*import\s+xapi\s+from\s+(['"])xapi\1[ \t]*;?[ \t]*(?:\/\/[^\r\n]*)?(?:\r?\n|$)/;

/*  Ergänzt nur die fehlenden Teile, ohne vorhandenen Code zu entfernen.  */
function addMemImport(content) {
  const missing =
    (memImportRegex.test(content) ? '' : importMemLine) +
    (localScriptRegex.test(content) ? '' : localScriptBlock);

  if (!xapiImportRegex.test(content)) {
    return importXapiLine + missing + content;
  }
  const lead = leadingXapiImportRegex.exec(content);
  if (!lead) {
    return missing + content;
  }
  const insertAt = lead[0].length;
  const lineBreak = lead[0].endsWith('\n') ? '' : '\n';
  return content.slice(0, insertAt) + lineBreak + missing + content.slice(insertAt);
}

function importMem() {
  if (config.autoImport.mode === false || config.autoImport.mode === 'false') {
    return Promise.resolve([]);
  }
  return xapi.Command.Macros.Macro.Get({ Content: 'True' })
    .then((macroList) => {
      if (!macroList?.Macro || !Array.isArray(macroList.Macro)) {
        return [];
      }

      const savePromises = [];

      macroList.Macro.forEach((m) => {
        if (!m || m.Content === null || m.Content === undefined) return;

        const hasXapi = xapiImportRegex.test(m.Content);
        const hasMemImp = memImportRegex.test(m.Content);
        const hasLocal = localScriptRegex.test(m.Content);

        const needsPatch = !(hasXapi && hasMemImp && hasLocal);

        /*   Das eigene Storage-/Utility-Macro NIE patchen,
             sonst droht Rekursion.                                */
        if (!needsPatch ||
          m.Name === 'Memory_Functions' ||
          m.Name === config.storageMacro) {
          return;
        }

        /*  Entscheidung nach autoImport-Modus  */
        const doPatch = (() => {
          switch (config.autoImport.mode) {
            case true:
            case 'true':
              return true;                                         // immer
            case false:
            case 'false':
              return false;                                        // nie
            case 'activeOnly':
              return m.Active === 'True';
            case 'custom':
              return config.autoImport.customImport.includes(m.Name);
            case 'customActive':
              return m.Active === 'True' &&
                config.autoImport.customImport.includes(m.Name);
            default:
              console.error(`Configuration Error: autoImport.mode "${config.autoImport.mode}" unknown – defaulting to "false".`);
              return false;
          }
        })();

        if (!doPatch) { return; }

        /*  Patch einfügen  */
        const newContent = addMemImport(m.Content);
        savePromises.push(
          xapi.Command.Macros.Macro.Save({ Name: m.Name }, newContent)
            .then(() => {
              console.log(`Added mem-import to macro "${m.Name}".`);
            })
        );
      });

      return Promise.all(savePromises);
    })
    .catch((e) => {
      console.error(e);
      throw e;
    });
}

/* ------------------------------------------------------------------ */
/*  5)   HILFS-FUNKTIONEN (READ / WRITE / REMOVE / PRINT)             */
/* ------------------------------------------------------------------ */

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/*  Scope-Objekt aus dem Store holen (kein Objekt → leerer Scope)  */
function scopeOf(store, scopeKey) {
  return (store && typeof store[scopeKey] === 'object' && store[scopeKey] !== null)
    ? store[scopeKey]
    : {};
}

/*  Komplettes Read-Modify-Write eines Scopes in einem Queue-Schritt  */
function withScope(scopeName, fn) {
  const scopeKey = scopeName || mem.localScript;
  return enqueue(() => getStore().then((store) => fn(store, scopeOf(store, scopeKey), scopeKey)));
}

mem.read = (key) => mem.read.scoped(key, undefined);

mem.read.global = (key) => enqueue(() => getStore().then((store) => {
  if (!hasOwn(store, key)) {
    throw new Error(`Global Read Error – key "${key}" not found.`);
  }
  return store[key];
}));

mem.write = (key, value) => mem.write.scoped(key, value, undefined);

mem.write.global = (key, value) => enqueue(() => getStore()
  .then((store) => {
    store[key] = value;
    return saveStore(store);
  })
  .then(() => {
    console.debug(`Global Write: ${key}`);
    return value;
  }));

mem.remove = (key) => mem.remove.scoped(key, undefined);

mem.remove.global = (key) => enqueue(() => getStore().then((store) => {
  if (!hasOwn(store, key)) {
    throw new Error(`Global Delete Error – key "${key}" not found.`);
  }

  delete store[key];

  return saveStore(store).then(() => {
    console.warn(`Global key "${key}" deleted.`);
    return key;
  });
}));

mem.print = () => mem.print.scoped(undefined);

mem.print.global = () => enqueue(() => getStore().then((store) => {
  console.log(store);
  return store;
}));

mem.info = () => {
  mem.read.global('./_$Info').then(console.log).catch(console.warn);
};

/* ------------------------------------------------------------------ */
/*  5.1) SCOPED API (Scope verhindert nur Überschreiben von            */
/*       mem.localScript; die Queue serialisiert Schreibzugriffe nur   */
/*       innerhalb dieser Modul-Instanz)                               */
/* ------------------------------------------------------------------ */

mem.for = (scopeName) => ({
  read: (key) => mem.read.scoped(key, scopeName),
  write: (key, value) => mem.write.scoped(key, value, scopeName),
  remove: (key) => mem.remove.scoped(key, scopeName),
  print: () => mem.print.scoped(scopeName),
  readGlobal: mem.read.global,
  writeGlobal: mem.write.global,
  removeGlobal: mem.remove.global,
  printGlobal: mem.print.global,
  info: mem.info,
  update: (key, updater) => updateScoped(key, updater, scopeName)
});

mem.read.scoped = (key, scopeName) => withScope(scopeName, (store, scope, scopeKey) => {
  if (!hasOwn(scope, key)) {
    throw new Error(`Local Read Error – key "${key}" not found in "${scopeKey}".`);
  }
  return scope[key];
});

mem.write.scoped = (key, value, scopeName) => withScope(scopeName, (store, scope, scopeKey) => {
  scope[key] = value;
  store[scopeKey] = scope;

  return saveStore(store).then(() => {
    console.debug(`Local Write: [${scopeKey}] ${key}`);
    return value;
  });
});

mem.remove.scoped = (key, scopeName) => withScope(scopeName, (store, scope, scopeKey) => {
  if (!hasOwn(scope, key)) {
    throw new Error(`Local Delete Error – key "${key}" not found in "${scopeKey}".`);
  }

  delete scope[key];
  store[scopeKey] = scope;

  return saveStore(store).then(() => {
    console.warn(`Local key "${key}" deleted from ${scopeKey}.`);
    return key;
  });
});

mem.print.scoped = (scopeName) => {
  const scopeKey = scopeName || mem.localScript;
  return enqueue(() => getStore().then((store) => {
    if (!hasOwn(store, scopeKey)) {
      throw new Error(`Global Read Error – key "${scopeKey}" not found.`);
    }
    console.log(store[scopeKey]);
    return store[scopeKey];
  }));
};

/*  Atomares Lesen → Ändern → Speichern eines vorhandenen Schlüssels (synchroner updater)  */
function updateScoped(key, updater, scopeName) {
  return withScope(scopeName, (store, scope, scopeKey) => {
    if (!hasOwn(scope, key)) {
      throw new Error(`Local Read Error – key "${key}" not found in "${scopeKey}".`);
    }

    /*  updater muss synchron sein: ein Promise würde als {} gespeichert,
        und ein darin wartender mem-Aufruf blockierte die Queue.  */
    const newValue = updater(scope[key]);
    if (newValue && typeof newValue.then === 'function') {
      throw new TypeError(`Local Update Error – updater for "${key}" must be synchronous.`);
    }
    scope[key] = newValue;
    store[scopeKey] = scope;

    return saveStore(store).then(() => {
      console.debug(`Local Write: [${scopeKey}] ${key}`);
      return newValue;
    });
  });
}

/* ------------------------------------------------------------------ */
/*  6)   INITIAL STARTUP SEQUENCE                                     */
/* ------------------------------------------------------------------ */
const memoryReady = memoryInit()
  .then(importMem)
  .catch((e) => {
    console.error(e);
    throw e;
  });

/* ------------------------------------------------------------------ */
/*  7)   EXPORT                                                       */
/* ------------------------------------------------------------------ */
export { mem, localScriptNameFrom, importMem, config, memoryReady };
