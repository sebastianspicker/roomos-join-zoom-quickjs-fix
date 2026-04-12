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
    throw new Error(`Memory store parse error: ${e.message}`);
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
/*  3)   INITIALISIERUNG DES STORAGE-MACROS                           */
/* ------------------------------------------------------------------ */
function memoryInit() {
  /*  Prüfen, ob das Storage-Macro bereits existiert  */
  return xapi.Command.Macros.Macro.Get({ Name: config.storageMacro })
    .then(() => undefined)                   // vorhanden → fertig
    .catch(() => {                           // nicht vorhanden → anlegen
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
        .then(() => mem.print.global());
    });
}

/* ------------------------------------------------------------------ */
/*  4)   AUTO-IMPORT-UNTERSTÜTZUNG                                    */
/* ------------------------------------------------------------------ */

/*  Template, das in andere Makros eingefügt wird, falls dort xapi/mem
    noch nicht importiert sind.  Die Zuweisung von localScript nutzt
    **bereits** den neuen ES-Modul-Ansatz und ist damit zukunftssicher.   */
const importTemplate =
  `import xapi from 'xapi';
import { mem } from './Memory_Functions';

mem.localScript = (typeof import.meta !== 'undefined' && import.meta.url)
  ? import.meta.url.split('/').pop().replace(/\\.js$/i, '')      // QuickJS / ES Modules
  : (typeof module !== 'undefined' && module.name)              // legacy Duktape
  || 'UnknownScript';                                           // final fallback

`;

function importMem() {
  if (config.autoImport.mode === false || config.autoImport.mode === 'false') {
    return Promise.resolve([]);
  }
  return xapi.Command.Macros.Macro.Get({ Content: 'True' })
    .then((macroList) => {
      if (!macroList?.Macro || !Array.isArray(macroList.Macro)) {
        return [];
      }

      /* Regex matches only at start of content to avoid replacing inside strings/comments */
      const importRegex =
        /^([\s\S]*?import\s+xapi\s+from\s+'xapi'(?:;|\s*)(?:\n|\r)*)?(\s*import\s+{\s*mem\s*}\s+from\s+'.\/Memory_Functions'(?:;|\s*)(?:\n|\r)*)?(\s*mem\.localScript\s*=.*(?:;|\s*))?/;

      const savePromises = [];

      macroList.Macro.forEach((m) => {
        if (!m || m.Content === null || m.Content === undefined) return;

        const hasXapi = /\s*import\s+xapi\s+from\s+'xapi'/.test(m.Content);
        const hasMemImp = /import\s+{\s*mem\s*}\s+from\s+'.\/Memory_Functions'/.test(m.Content);
        const hasLocal = /mem\.localScript\s*=/.test(m.Content);

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
        const newContent = m.Content.replace(importRegex, importTemplate);
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

mem.read = (key) => new Promise((resolve, reject) => {
  mem.read.scoped(key, undefined).then(resolve).catch(reject);
});

mem.read.global = (key) => new Promise((resolve, reject) => {
  getStore()
    .then((store) => {
      if (Object.prototype.hasOwnProperty.call(store, key)) {
        resolve(store[key]);
        return;
      }
      reject(new Error(`Global Read Error – key "${key}" not found.`));
    })
    .catch(reject);
});

mem.write = (key, value) => new Promise((resolve, reject) => {
  mem.write.scoped(key, value, undefined)
    .then(() => {
      resolve(value);
    })
    .catch(reject);
});

mem.write.global = (key, value) => new Promise((resolve, reject) => {
  getStore()
    .then((store) => {
      store[key] = value;
      return saveStore(store);
    })
    .then(() => {
      console.debug(`Global Write: ${key}`);
      resolve(value);
    })
    .catch(reject);
});

mem.remove = (key) => new Promise((resolve, reject) => {
  mem.remove.scoped(key, undefined).then(resolve).catch(reject);
});

mem.remove.global = (key) => new Promise((resolve, reject) => {
  getStore()
    .then((store) => {
      if (!Object.prototype.hasOwnProperty.call(store, key)) {
        reject(new Error(`Global Delete Error – key "${key}" not found.`));
        return;
      }

      delete store[key];

      return saveStore(store).then(() => {
        console.warn(`Global key "${key}" deleted.`);
        resolve(key);
      });
    })
    .catch(reject);
});

mem.print = () => new Promise((resolve, reject) => {
  mem.print.scoped(undefined).then(resolve).catch(reject);
});

mem.print.global = () => new Promise((resolve, reject) => {
  getStore().then((store) => {
    console.log(store);
    resolve(store);
  }).catch(reject);
});

mem.info = () => {
  mem.read.global('./_$Info').then(console.log).catch(console.warn);
};

/* ------------------------------------------------------------------ */
/*  5.1) SCOPED API (vermeidet race conditions zwischen Makros)        */
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
  info: mem.info
});

mem.read.scoped = (key, scopeName) => new Promise((resolve, reject) => {
  const scopeKey = scopeName || mem.localScript;

  getStore()
    .then((store) => {
      const scope = (store && typeof store[scopeKey] === 'object' && store[scopeKey] !== null)
        ? store[scopeKey]
        : {};

      if (Object.prototype.hasOwnProperty.call(scope, key)) {
        resolve(scope[key]);
        return;
      }

      reject(new Error(`Local Read Error – key "${key}" not found in "${scopeKey}".`));
    })
    .catch(reject);
});

mem.write.scoped = (key, value, scopeName) => new Promise((resolve, reject) => {
  const scopeKey = scopeName || mem.localScript;

  getStore()
    .then((store) => {
      const scope = (store && typeof store[scopeKey] === 'object' && store[scopeKey] !== null)
        ? store[scopeKey]
        : {};

      scope[key] = value;
      store[scopeKey] = scope;

      return saveStore(store).then(() => {
        console.debug(`Local Write: [${scopeKey}] ${key}`);
        resolve(value);
      });
    })
    .catch(reject);
});

mem.remove.scoped = (key, scopeName) => new Promise((resolve, reject) => {
  const scopeKey = scopeName || mem.localScript;

  getStore()
    .then((store) => {
      const scope = (store && typeof store[scopeKey] === 'object' && store[scopeKey] !== null)
        ? store[scopeKey]
        : {};

      if (!Object.prototype.hasOwnProperty.call(scope, key)) {
        reject(new Error(`Local Delete Error – key "${key}" not found in "${scopeKey}".`));
        return;
      }

      delete scope[key];
      store[scopeKey] = scope;

      return saveStore(store).then(() => {
        console.warn(`Local key "${key}" deleted from ${scopeKey}.`);
        resolve(key);
      });
    })
    .catch(reject);
});

mem.print.scoped = (scopeName) => new Promise((resolve, reject) => {
  const scopeKey = scopeName || mem.localScript;
  mem.read.global(scopeKey)
    .then((data) => { console.log(data); resolve(data); })
    .catch(reject);
});

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
