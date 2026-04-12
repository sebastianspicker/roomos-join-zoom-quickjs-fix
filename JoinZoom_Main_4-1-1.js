/**
 * JoinZoom_Main_4-1-1
 * Author: Robert McGonigle Jr (Harvard University IT). Update 2025: Sebastian J. Spicker.
 * Description: Simple UX for joining Zoom meetings; Zoom DTMF Tools, Config (JoinZoom_Config_4-1-1), Flavor Text (JoinZoom_JoinText_4-1-1).
 * Dependencies: JoinZoom_Config_4-1-1, JoinZoom_JoinText_4-1-1, Memory_Functions, Memory_Storage.
 * Changelog: See README or original Cisco DevNet Join Zoom macro repo.
 */

import xapi from 'xapi';
import { config, sleep, checkRegex, findDTMF, sendDTMF, dialZoom, handleDualScreen } from './JoinZoom_Config_4-1-1'
import { page } from './JoinZoom_JoinText_4-1-1'
import { mem, localScriptNameFrom, memoryReady } from './Memory_Functions';

/* btoa/atob polyfill for environments (e.g. QuickJS) that do not provide them */
if (typeof btoa === 'undefined') {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    globalThis.btoa = (str) => {
        let s = String(str);
        let out = '';
        for (let i = 0; i < s.length; i += 3) {
            const a = s.charCodeAt(i);
            const b = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
            const c = i + 2 < s.length ? s.charCodeAt(i + 2) : 0;
            out += chars[a >>> 2] + chars[((a & 3) << 4) | (b >>> 4)] + (i + 1 < s.length ? chars[((b & 15) << 2) | (c >>> 6)] : '=') + (i + 2 < s.length ? chars[c & 63] : '=');
        }
        return out;
    };
}
if (typeof atob === 'undefined') {
    globalThis.atob = (str) => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
        let s = String(str).replace(/=+$/, '');
        if (s.length % 4 === 1) throw new Error('Invalid base64 string');
        let out = '';
        for (let i = 0; i < s.length; i += 4) {
            const a = chars.indexOf(s[i]); const b = chars.indexOf(s[i + 1]);
            const c = chars.indexOf(s[i + 2]); const d = chars.indexOf(s[i + 3]);
            out += String.fromCharCode((a << 2) | (b >>> 4));
            if (c !== -1) out += String.fromCharCode(((b & 15) << 4) | (c >>> 2));
            if (d !== -1) out += String.fromCharCode(((c & 3) << 6) | d);
        }
        return out;
    };
}

const localScriptName = localScriptNameFrom({
    importMetaUrl: (typeof import.meta !== 'undefined' && import.meta.url) ? import.meta.url : undefined,
    moduleName: (typeof module !== 'undefined' && module.name) ? module.name : undefined,
    fallbackName: 'JoinZoom_Main_4-1-1'
});

const localMem = mem.for(localScriptName);

/** Base64-encoded keys for PMI storage (meeting ID, passcode, host key). */
const PMI_KEYS = {
  info: btoa('PMIInfo'),
  meetingId: btoa('MeetingId'),
  passcode: btoa('Passcode'),
  hostKey: btoa('HostKey')
};

/** Decode base64 safely; returns '' for null/undefined/invalid to avoid atob() throws. */
function safeB64Decode(s) {
  if (s === null || s === undefined || s === '') return '';
  try {
    return atob(String(s));
  } catch {
    return '';
  }
}

/** True when companion macros have provided valid config and page. */
function isConfigAndPageReady() {
  return typeof config !== 'undefined' && config?.ui?.settings &&
    typeof page !== 'undefined' && typeof page.meetingID === 'function';
}

/** Panel/widget ID prefix for joinZoom panels (joinZoom~version). Safe when config not ready. */
function prefixJoinZoom() {
  const v = (typeof config !== 'undefined' && config !== null && config.version !== undefined && config.version !== null) ? config.version : 'unknown';
  return `joinZoom~${v}`;
}

/** FeedbackId prefix for join_zoom_v_version. Safe when config not ready. */
function prefixJoinZoomV() {
  const v = (typeof config !== 'undefined' && config !== null && config.version !== undefined && config.version !== null) ? config.version : 'unknown';
  return `join_zoom_v_${v}`;
}

/** Full widget/panel ID for joinZoom: joinZoom~version~suffix. Safe when config not ready. */
function widgetIdJoinZoom(suffix) {
  const v = (typeof config !== 'undefined' && config !== null && config.version !== undefined && config.version !== null) ? config.version : 'unknown';
  return `joinZoom~${v}~${suffix}`;
}

/** Style panel base name: Style_New+Personal or Style_New. */
function styleBase(personal) {
  return personal ? 'Style_New+Personal' : 'Style_New';
}

/** Panel ID for Zoom Tools: jzoomTools~version~suffix. Safe when config not ready. */
function panelIdZoomTools(suffix) {
  const v = (typeof config !== 'undefined' && config !== null && config.version !== undefined && config.version !== null) ? config.version : 'unknown';
  return `jzoomTools~${v}~${suffix}`;
}

/** Show "Connecting to Zoom" prompt with meeting ID; duration 5 (host) or 20 (participant). */
function showConnectingPrompt(meetingIdB64, isHost) {
  const decoded = safeB64Decode(meetingIdB64);
  xapi.command('UserInterface Message Prompt Display', {
    Title: 'Connecting to Zoom',
    Text: isHost ? `Entering Meeting: ${decoded}` : `Entering Meeting: ${decoded}<p>Please wait for the host to start the call.`,
    Duration: isHost ? 5 : 20,
    'Option.1': 'Dismiss'
  });
}

/** Open the New-style join panel and reset placeholder widget values. */
function openNewStylePanel(personal) {
  const base = styleBase(personal);
  xapi.command('UserInterface Extensions Panel Open', {
    PanelId: widgetIdJoinZoom(base)
  });
  xapi.command('UserInterface Extensions Widget SetValue', {
    Value: '5-40 Digit Meeting Id',
    WidgetId: widgetIdJoinZoom(base + '~MeetingId~Text')
  });
  xapi.command('UserInterface Extensions Widget SetValue', {
    Value: 'Passcode',
    WidgetId: widgetIdJoinZoom(base + '~Passcode~Text')
  });
  xapi.command('UserInterface Extensions Widget Action', {
    Type: 'released',
    WidgetId: widgetIdJoinZoom(base + '~Role'),
    Value: widgetIdJoinZoom(base + '~Role~Participant')
  });
  xapi.command('UserInterface Extensions Widget SetValue', {
    Value: '- - - - - - - - - - - - - -',
    WidgetId: widgetIdJoinZoom(base + '~HostKey~Text')
  });
}

let meetingInfo = {
    meetingid: '',
    passcode: '',
    hostkey: '',
    role: ''
}

async function init() {
    await memoryReady;
    const message = { 'Init': {} };
    if (typeof config === 'undefined' || !config?.version || !config?.ui?.settings) {
        console.error('JoinZoom_Main: config missing or invalid.');
        message.Init.error = 'config missing';
        return message;
    }
    if (typeof page === 'undefined' || typeof page.meetingID !== 'function') {
        console.error('JoinZoom_Main: page (JoinText) missing or invalid.');
        message.Init.error = 'page missing';
        return message;
    }
    await sleep(5000);
    let pmiInfo = {
        [PMI_KEYS.meetingId]: "",
        [PMI_KEYS.passcode]: "",
        [PMI_KEYS.hostKey]: ""
    };
    detectCall();
    zoomToolsVisibility('Hidden');
    if (config.ui.settings.joinWebex) {
        await xapi.config.set('UserInterface Features Call JoinWebex', 'Auto');
    } else {
        await xapi.config.set('UserInterface Features Call JoinWebex', 'Hidden');
    }
    message.Init['PersonalMode'] = {}
    if (config.ui.settings.personalMode) {
        await localMem.read(PMI_KEYS.info).then((result) => {
            message.Init.PersonalMode['Enabled'] = true;
            let isSet = 0;
            if (result[PMI_KEYS.meetingId] === '' || result[PMI_KEYS.meetingId] === undefined) {
                isSet++;
            }
            if (result[PMI_KEYS.passcode] === '' || result[PMI_KEYS.passcode] === undefined) {
                isSet++;
            }
            if (result[PMI_KEYS.hostKey] === '' || result[PMI_KEYS.hostKey] === undefined) {
                isSet++;
            }
            if (isSet > 0) {
                message.Init.PersonalMode['isSet?'] = false;
            } else {
                message.Init.PersonalMode['isSet?'] = true;
            }
        }).catch((e) => {
            console.debug('JoinZoom_Main: PMI read failed (first run or storage reset), initializing:', e);
            return localMem.write(PMI_KEYS.info, pmiInfo).then(() => {
                message.Init.PersonalMode['Enabled'] = true;
                message.Init.PersonalMode['isSet?'] = false;
            })
        })
    } else {
        message.Init.PersonalMode['Enabled'] = false;
        message.Init.PersonalMode['isSet?'] = false;
        await mem.remove.global(localScriptName).catch((e) => {
            console.debug('JoinZoom_Main: global memory cleanup skipped (key may not exist):', e);
        });
    }
    return message;
}

init().then((message) => {
    if (message?.Init?.error) {
        console.info(message, 'JoinZoom_Main: init incomplete (config/page missing).');
    } else {
        console.info(message, 'JoinZoom_Main: init complete. Script ready for use.');
    }
}).catch((e) => {
    console.error('JoinZoom_Main: init failed:', e);
});

function zoomToolsVisibility(visibility) {
    if (!isConfigAndPageReady()) return;
    if (config.ui.settings.dtmfTools) {
        xapi.command('UserInterface Extensions Panel Update', {
            PanelId: panelIdZoomTools('Tools~Visible'),
            Visibility: visibility
        });
    } else {
        xapi.command('UserInterface Extensions Panel Update', {
            PanelId: panelIdZoomTools('Tools~Visible'),
            Visibility: 'Hidden'
        });
    }
}

let detectCallActive = false;
function detectCall() {
    if (detectCallActive) return;
    detectCallActive = true;
    xapi.status.once('Call RemoteNumber', (remoteNumber) => {
        detectCallActive = false;
        xapi.event.once('CallSuccessful', () => {
            if (!isConfigAndPageReady()) return;
            if (typeof remoteNumber !== 'string') {
                console.warn('detectCall: unexpected remoteNumber type:', typeof remoteNumber, remoteNumber);
                return;
            }
            const anyRegex = config.regex?.zoom_SIP?.any;
            const verifyZoom = anyRegex ? anyRegex.test(remoteNumber) : false;
            if (verifyZoom) {
                zoomToolsVisibility('Auto');
                const hostKeyRegex = config.regex?.zoom_SIP?.strict?.hostKey;
                if (hostKeyRegex && hostKeyRegex.test(remoteNumber)) {
                    meetingInfo.role = 'host';
                }
            } else {
                zoomToolsVisibility('Hidden');
            }
        })
    })
}

const ZOOM_CALLBACK_DOMAIN_ALLOWLIST = 'lej.zmeu.us';

xapi.event.on('CallDisconnect', () => {
    meetingInfo = {
        meetingid: '',
        passcode: '',
        hostkey: '',
        role: ''
    };
    zoomToolsVisibility('Hidden');
    if (typeof config !== 'undefined' && config?.securityMode === 'On') {
        xapi.command('CallHistory Get', {

        }).then((result) => {
            const entries = result?.Entry || [];
            if (entries.length === 0) return;

            entries.forEach((entry) => {
                const temp = entry.CallbackNumber?.split('@');
                if (temp?.[1] === ZOOM_CALLBACK_DOMAIN_ALLOWLIST) {
                    xapi.command('CallHistory DeleteEntry', {
                        CallHistoryId: entry.CallHistoryId,
                        DeleteConsecutiveDuplicates: 'True'
                    }).catch(() => { });
                }
            });
        }).catch((e) => { console.warn('CallHistory Get failed:', e); });
    }
    detectCall();
});

xapi.event.on('UserInterface Extensions Panel Clicked', (event) => {
    if (!isConfigAndPageReady()) return;
    switch (event.PanelId) {
        case prefixJoinZoom():
            handleDualScreen();
            switch (config.ui.settings.style) {
                case 'new':
                    meetingInfo = {
                        meetingid: '',
                        passcode: '',
                        hostkey: '',
                        role: ''
                    };
                    if (config.ui.settings.personalMode) {
                        localMem.read(PMI_KEYS.info).then((response) => {
                            const pmiInfo = {
                                [PMI_KEYS.meetingId]: response[PMI_KEYS.meetingId],
                                [PMI_KEYS.passcode]: response[PMI_KEYS.passcode],
                                [PMI_KEYS.hostKey]: response[PMI_KEYS.hostKey]
                            };
                            updatePersonalTextbox(pmiInfo[PMI_KEYS.meetingId], pmiInfo[PMI_KEYS.passcode], pmiInfo[PMI_KEYS.hostKey]);
                        }).catch((e) => { console.debug('JoinZoom_Main: PMI read failed on panel open (defaults will be shown):', e); });
                        openNewStylePanel(true);
                    } else {
                        openNewStylePanel(false);
                    }
                    break;
                case 'classic':
                default:
                    page.meetingID(config.additionalFlavorText);
                    break;
            }
            break;
        case panelIdZoomTools('Tools~Visible'):
            switch (meetingInfo.role) {
                case 'host':
                    xapi.command('UserInterface Extensions Panel Open', {
                        PanelId: panelIdZoomTools('Tools~host')
                    });
                    break;
                case 'participant':
                default:
                    xapi.command('UserInterface Extensions Panel Open', {
                        PanelId: panelIdZoomTools('Tools~participant')
                    });
                    break;
            }
            break;
        default:
            break;
    }
})

xapi.event.on('UserInterface Message TextInput Response', (event) => {
    if (!event?.FeedbackId || typeof event.FeedbackId !== 'string') return;
    if (!isConfigAndPageReady()) return;
    const x = event.FeedbackId.split('~');
    if (x.length < 3) return;
    const feedbackVersion = x[0];
    const text = event.Text ?? '';
    let pmiInfo = {
        [PMI_KEYS.meetingId]: "",
        [PMI_KEYS.passcode]: "",
        [PMI_KEYS.hostKey]: ""
    };
    page.number = x[1];
    page.type = x[2];
    console.debug('Scope: ', page.number, page.type);
    if (feedbackVersion === prefixJoinZoomV()) {
        switch (page.number) {
            case '01':
                checkRegex(text, 'meetingid').then((check) => {
                    if (check) {
                        meetingInfo.meetingid = btoa(text);
                        switch (page.type) {
                            case 'opr':
                            case 'err':
                                if (config.ui.settings.style === 'new') {
                                    if (config.ui.settings.personalMode) {
                                        xapi.command('UserInterface Extensions Widget SetValue', {
                                            Value: text,
                                            WidgetId: widgetIdJoinZoom(styleBase(true) + '~MeetingId~Text')
                                        });
                                    } else {
                                        xapi.command('UserInterface Extensions Widget SetValue', {
                                            Value: text,
                                            WidgetId: widgetIdJoinZoom(styleBase(false) + '~MeetingId~Text')
                                        });
                                    }
                                } else {
                                    page.role(text);
                                }
                                break;
                            default:
                                break;
                        }
                    }
                }).catch((e) => {
                    console.warn('JoinZoom_Main: validation failed, prompting user to re-enter:', e);
                    page.meetingID.error();
                })
                break;
            case '03':
                checkRegex(text, 'passcode').then((check) => {
                    if (check === true) {
                        meetingInfo.passcode = btoa(text);
                        switch (page.type) {
                            case 'opr':
                            case 'err':
                                if (config.ui.settings.style === 'new') {
                                    if (config.ui.settings.personalMode) {
                                        xapi.command('UserInterface Extensions Widget SetValue', {
                                            Value: text,
                                            WidgetId: widgetIdJoinZoom(styleBase(true) + '~Passcode~Text')
                                        });
                                    } else {
                                        xapi.command('UserInterface Extensions Widget SetValue', {
                                            Value: text,
                                            WidgetId: widgetIdJoinZoom(styleBase(false) + '~Passcode~Text')
                                        });
                                    }
                                } else {
                                    if (meetingInfo.role === 'participant') {
                                        page.confirmation(safeB64Decode(meetingInfo.meetingid), meetingInfo.role, safeB64Decode(meetingInfo.passcode), safeB64Decode(meetingInfo.hostkey));
                                    } else {
                                        page.hostKey(text);
                                    }
                                }
                                break;
                            default:
                                break;
                        }
                    }
                }).catch((e) => {
                    console.warn('JoinZoom_Main: validation failed, prompting user to re-enter:', e);
                    page.passcode.error();
                })
                break;
            case '04':
                checkRegex(text, 'hostkey').then((check) => {
                    if (check === true) {
                        meetingInfo.hostkey = btoa(text);
                        switch (page.type) {
                            case 'opr':
                            case 'err':
                                if (config.ui.settings.style === 'new') {
                                    meetingInfo.role = 'host';
                                    if (config.ui.settings.personalMode) {
                                        xapi.command('UserInterface Extensions Widget SetValue', {
                                            Value: `Host Key: ${text}`,
                                            WidgetId: widgetIdJoinZoom(styleBase(true) + '~HostKey~Text')
                                        });
                                    } else {
                                        xapi.command('UserInterface Extensions Widget SetValue', {
                                            Value: `Host Key: ${text}`,
                                            WidgetId: widgetIdJoinZoom(styleBase(false) + '~HostKey~Text')
                                        });
                                    }
                                } else {
                                    page.confirmation(safeB64Decode(meetingInfo.meetingid), meetingInfo.role, safeB64Decode(meetingInfo.passcode), safeB64Decode(meetingInfo.hostkey));
                                }
                                break;
                            default:
                                break;
                        }
                    }
                }).catch((e) => {
                    console.warn('JoinZoom_Main: validation failed, prompting user to re-enter:', e);
                    page.hostKey.error();
                })
                break;
            case 'p1':
                switch (page.type) {
                    case 'opr':
                    case 'err':
                        localMem.read(PMI_KEYS.info).then((response) => {
                            pmiInfo = {
                                [PMI_KEYS.meetingId]: btoa(text),
                                [PMI_KEYS.passcode]: response[PMI_KEYS.passcode],
                                [PMI_KEYS.hostKey]: response[PMI_KEYS.hostKey]
                            };
                            updatePersonalTextbox(pmiInfo[PMI_KEYS.meetingId], pmiInfo[PMI_KEYS.passcode], pmiInfo[PMI_KEYS.hostKey]);
                            localMem.write(PMI_KEYS.info, pmiInfo).catch((e) => { console.warn('PMI write failed:', e); });
                        }).catch((e) => { console.debug('JoinZoom_Main: PMI read failed while updating meeting ID:', e); });
                        break;
                }
                break;
            case 'p2':
                switch (page.type) {
                    case 'opr':
                    case 'err':
                        localMem.read(PMI_KEYS.info).then((response) => {
                            pmiInfo = {
                                [PMI_KEYS.meetingId]: response[PMI_KEYS.meetingId],
                                [PMI_KEYS.passcode]: btoa(text),
                                [PMI_KEYS.hostKey]: response[PMI_KEYS.hostKey]
                            };
                            updatePersonalTextbox(pmiInfo[PMI_KEYS.meetingId], pmiInfo[PMI_KEYS.passcode], pmiInfo[PMI_KEYS.hostKey]);
                            localMem.write(PMI_KEYS.info, pmiInfo).catch((e) => { console.warn('PMI write failed:', e); });
                        }).catch((e) => { console.debug('JoinZoom_Main: PMI read failed while updating passcode:', e); });
                        break;
                }
                break;
            case 'p3':
                switch (page.type) {
                    case 'opr':
                    case 'err':
                        localMem.read(PMI_KEYS.info).then((response) => {
                            pmiInfo = {
                                [PMI_KEYS.meetingId]: response[PMI_KEYS.meetingId],
                                [PMI_KEYS.passcode]: response[PMI_KEYS.passcode],
                                [PMI_KEYS.hostKey]: btoa(text)
                            };
                            updatePersonalTextbox(pmiInfo[PMI_KEYS.meetingId], pmiInfo[PMI_KEYS.passcode], pmiInfo[PMI_KEYS.hostKey]);
                            localMem.write(PMI_KEYS.info, pmiInfo).catch((e) => { console.warn('PMI write failed:', e); });
                        }).catch((e) => { console.debug('JoinZoom_Main: PMI read failed while updating host key:', e); });
                        break;
                }
                break;
            default:
                break;
        }
    }
})

xapi.event.on('UserInterface Message TextInput Clear', (event) => {
    if (!event?.FeedbackId || config?.ui?.settings?.style !== 'new') return;
    switch (event.FeedbackId) {
        case prefixJoinZoomV() + '~04~opr':
        case prefixJoinZoomV() + '~04~err':
            if (config.ui.settings.personalMode) {
                xapi.command('UserInterface Extensions Widget Action', {
                    Type: 'released',
                    WidgetId: widgetIdJoinZoom(styleBase(true) + '~Role'),
                    Value: widgetIdJoinZoom(styleBase(true) + '~Role~Participant')
                });
            } else {
                xapi.command('UserInterface Extensions Widget Action', {
                    Type: 'released',
                    WidgetId: widgetIdJoinZoom(styleBase(false) + '~Role'),
                    Value: widgetIdJoinZoom(styleBase(false) + '~Role~Participant')
                });
            }
            break;
        default:
            break;
    }
})

xapi.event.on('UserInterface Message Prompt Response', (event) => {
    if (!event?.FeedbackId || typeof event.FeedbackId !== 'string') return;
    if (!isConfigAndPageReady()) return;
    const x = event.FeedbackId.split('~');
    if (x.length < 3) return;
    const feedbackVersion = x[0];
    page.number = x[1];
    page.type = x[2];
    console.debug('Scope: ', page.number, page.type);
    if (feedbackVersion === prefixJoinZoomV()) {
        switch (page.number) {
            case '02':
                if (x[2] === 'opr') {
                    if (config.ui.settings.style === 'new') {
                        switch (event.OptionId) {
                            case '1':
                                page.passcode(safeB64Decode(meetingInfo.meetingid), "Enter");
                                break;
                            case '2':
                                dialZoom(meetingInfo.meetingid, meetingInfo.passcode, meetingInfo.hostkey);
                                showConnectingPrompt(meetingInfo.meetingid, meetingInfo.role === 'host');
                                break;
                            case '3':
                                break;
                            default:
                                break;
                        }
                    } else {
                        switch (event.OptionId) {
                            case '1':
                                meetingInfo.role = 'participant';
                                page.passcode(safeB64Decode(meetingInfo.meetingid));
                                break;
                            case '2':
                                meetingInfo.role = 'host';
                                page.passcode(safeB64Decode(meetingInfo.meetingid));
                                break;
                            case '3':
                                break;
                            default:
                                break;
                        }
                    }
                }
                break;
            case '05':
            case '1':
                dialZoom(meetingInfo.meetingid, meetingInfo.passcode, meetingInfo.hostkey);
                showConnectingPrompt(meetingInfo.meetingid, meetingInfo.role === 'host');
                break;
            case '2':
                break;
            case '3':
                break;
            default:
                break;
        }
    }
})

xapi.event.on('UserInterface Extensions Widget Action', (event) => {
    if (!isConfigAndPageReady()) return;
    if (event.Type === 'released') {
        findDTMF(event.WidgetId).then((result) => {
            if (result?.source === 'zoomTools') {
                console.debug(`"${result.nickName}" released, entering DTMF.`);
                switch (config.ui.settings.dtmfFeedback?.mode) {
                    case 'On':
                        sendDTMF.normal(result.dtmfSequence);
                        break;
                    case 'Off':
                    case 'Tone':
                        sendDTMF.silence(result.dtmfSequence);
                        break;
                    case 'Soften':
                        sendDTMF.soften(result.dtmfSequence);
                        break;
                }
            }
        }).catch(() => { });
        switch (event.WidgetId) {
            case widgetIdJoinZoom(styleBase(false) + '~MeetingId~Enter'):
            case widgetIdJoinZoom(styleBase(true) + '~MeetingId~Enter'):
                page.meetingID(config.additionalFlavorText, 'Enter');
                break;
            case widgetIdJoinZoom(styleBase(false) + '~Passcode~Enter'):
            case widgetIdJoinZoom(styleBase(true) + '~Passcode~Enter'):
                page.passcode(safeB64Decode(meetingInfo.meetingid), 'Enter');
                break;
            case widgetIdJoinZoom(styleBase(false) + '~Role'):
            case widgetIdJoinZoom(styleBase(true) + '~Role'):
                switch (event.Value) {
                    case widgetIdJoinZoom(styleBase(false) + '~Role~Participant'):
                    case widgetIdJoinZoom(styleBase(true) + '~Role~Participant'):
                        meetingInfo.role = 'participant';
                        break;
                    case widgetIdJoinZoom(styleBase(false) + '~Role~Host'):
                    case widgetIdJoinZoom(styleBase(true) + '~Role~Host'):
                        page.hostKey(safeB64Decode(meetingInfo.meetingid), 'Enter');
                        break;
                    default:
                        break;
                }
                break;
            case widgetIdJoinZoom(styleBase(false) + '~HostKey~CallZoom'):
            case widgetIdJoinZoom(styleBase(true) + '~HostKey~CallZoom'):
                if (meetingInfo.meetingid === '') {
                    page.missing.meetingId('', 'Enter');
                } else {
                    if (meetingInfo.passcode === '') {
                        page.missing.passcode();
                    } else {
                        dialZoom(meetingInfo.meetingid, meetingInfo.passcode, meetingInfo.hostkey);
                        showConnectingPrompt(meetingInfo.meetingid, meetingInfo.role === 'host');
                    }
                }
                break;
            case widgetIdJoinZoom(styleBase(true) + '~HostKey~CallPersonalZoom'):
                localMem.read(PMI_KEYS.info).then((result) => {
                    const mid = result?.[PMI_KEYS.meetingId];
                    const pwd = result?.[PMI_KEYS.passcode];
                    const hk = result?.[PMI_KEYS.hostKey];
                    if (mid === null || mid === undefined || mid === '' || pwd === null || pwd === undefined || pwd === '') {
                        console.warn('CallPersonalZoom: PMIInfo missing or incomplete.');
                        return;
                    }
                    meetingInfo = {
                        meetingid: mid,
                        passcode: pwd,
                        hostkey: hk ?? '',
                        role: 'host'
                    };
                    dialZoom(meetingInfo.meetingid, meetingInfo.passcode, meetingInfo.hostkey);
                }).catch((e) => {
                    console.warn('JoinZoom_Main: CallPersonalZoom failed to read PMI from storage:', e);
                });
                break;
            case widgetIdJoinZoom(styleBase(true) + '~Store~MeetingId~Enter'):
                page.personal.meetingId();
                break;
            case widgetIdJoinZoom(styleBase(true) + '~Store~Passcode~Enter'):
                page.personal.passcode();
                break;
            case widgetIdJoinZoom(styleBase(true) + '~Store~HostKey~Enter'):
                page.personal.hostKey();
                break;
            default:
                break;
        }
    }
})

function updatePersonalTextbox(id, pass, key) {
    let string = {
        thisID: "Not Set",
        thisPass: "Not Set",
        thisKey: "Not Set"
    }

    // Note: Base64 (atob) is NOT encryption.
    if (id !== '' && id !== undefined && id !== null) {
        try {
            string.thisID = atob(id);
        } catch (e) {
            console.warn('updatePersonalTextbox: Invalid Base64 for ID', e);
            string.thisID = 'Invalid';
        }
    }
    if (pass !== '' && pass !== undefined && pass !== null) {
        string.thisPass = "Set";
    }
    if (key !== '' && key !== undefined && key !== null) {
        string.thisKey = "Set";
    }
    xapi.command('UserInterface Extensions Widget SetValue', {
        Value: `Meeting ID: ${string.thisID} || Passcode: ${string.thisPass} || HostKey: ${string.thisKey}`,
        WidgetId: widgetIdJoinZoom(styleBase(true) + '~Store~MeetingId~Text')
    });
}
