// English -> Italian translation table for the Trident dashboard.
// Keys are the exact English source strings (labels, options, button text,
// tooltip data-tip values). Missing keys fall back to English.
window.TRIDENT_I18N = {
  it: {
    // ---------- Status band ----------
    'Engine': 'Motore',
    'State': 'Stato',
    'Price': 'Prezzo',
    'Current setup': 'Setup corrente',
    'None loaded': 'Nessuno caricato',
    'Today': 'Oggi',
    'Disconnected': 'Disconnesso',
    'Connecting…': 'Connessione…',
    'Reconnecting…': 'Riconnessione…',
    'Connected': 'Connesso',
    'idle': 'inattivo',
    'watching': 'in osservazione',
    'in_trade': 'in trade',
    'closed': 'chiuso',
    'blocked': 'bloccato',
    'locked': 'bloccato (lock)',

    // ---------- Top buttons ----------
    'Status': 'Stato',
    'New setup': 'Nuovo setup',
    'Update during session': 'Aggiorna in sessione',
    'Pre-fill from latest': "Precompila dall'ultimo",
    '✨ Import from screenshots': '✨ Importa da screenshot',
    '(optional)': '(opzionale)',
    '(paired)': '(accoppiato)',
    'now': 'adesso',
    'today': 'oggi',
    'Provide as complete pairs (both BUY OUTER+INNER, or both SELL OUTER+INNER, or both). At least one pair is required — the engine skips a side whose pair is incomplete.':
      'Fornisci come coppie complete (entrambi BUY OUTER+INNER, o entrambi SELL OUTER+INNER, o entrambe). È richiesta almeno una coppia — il motore salta il lato la cui coppia è incompleta.',

    // ---------- Fieldset legends ----------
    'Meta': 'Meta',
    'Volatility': 'Volatilità',
    'VWAP': 'VWAP',
    'Ranges [ES futures]': 'Range [ES futures]',
    'Levels [ES futures]': 'Livelli [ES futures]',
    'Bias': 'Bias',
    'Invalidation [ES futures]': 'Invalidazione [ES futures]',

    // ---------- Meta fields ----------
    'Date': 'Data',
    'Time': 'Ora',
    'update_seq': 'update_seq',
    'Contract': 'Contratto',
    'Futures last [ES futures]': 'Ultimo futures [ES futures]',
    'Cash last [SPX cash]': 'Ultimo cash [SPX cash]',
    'Basis [points]': 'Basis [punti]',
    'Execution instrument': 'Strumento di esecuzione',

    // ---------- Volatility fields ----------
    'DVS': 'DVS',
    'DVS prior': 'DVS precedente',
    'Skew': 'Skew',
    'Regime': 'Regime',
    'compressed': 'compresso',
    'normal': 'normale',
    'elevated': 'elevato',
    'extreme': 'estremo',

    // ---------- VWAP fields ----------
    'Value [ES futures — TBC with FB]': 'Valore [ES futures — da confermare con FB]',
    'Updated at': 'Aggiornato alle',
    'Source': 'Fonte',
    'manual': 'manuale',

    // ---------- Ranges fields ----------
    'Range 1 up': 'Range 1 sup',
    'Range 2 up': 'Range 2 sup',
    'Range 2 down': 'Range 2 inf',
    'Range 1 down': 'Range 1 inf',

    // ---------- Levels fields ----------
    'Level time': 'Ora livelli',
    'SELL OUTER': 'SELL OUTER',
    'SELL INNER': 'SELL INNER',
    'BUY OUTER': 'BUY OUTER',
    'BUY INNER': 'BUY INNER',
    'Support': 'Supporto',
    'Resistance': 'Resistenza',

    // ---------- Bias fields ----------
    'Direction': 'Direzione',
    '(none)': '(nessuno)',
    'long': 'long',
    'short': 'short',
    'neutral': 'neutro',
    'Confidence': 'Confidenza',
    'low': 'bassa',
    'medium': 'media',
    'high': 'alta',
    'Notes': 'Note',

    // ---------- Invalidation fields ----------
    'Void above': 'Nullo sopra',
    'Void below': 'Nullo sotto',
    'Expiry': 'Scadenza',

    // ---------- Submit + log ----------
    'Submit setup': 'Invia setup',
    'Live log': 'Log live',
    'Clear': 'Pulisci',
    "Events stream in as the engine fires them — setup load, trade plan, entries, breakeven, close, daily lock. Price ticks are suppressed. Events from before the browser connected don't back-fill.":
      "Gli eventi compaiono in tempo reale mentre il motore li genera — caricamento setup, piano di trade, ingressi, breakeven, chiusura, lock giornaliero. I tick di prezzo non vengono mostrati. Gli eventi precedenti alla connessione del browser non vengono recuperati.",
    "Wipe the log pane in this browser tab. Does not affect the engine, the setups/ folder, or other connected tabs — purely a local view reset. Useful when the log gets noisy and you want a fresh window into upcoming events.":
      "Pulisce il pannello dei log in questo tab del browser. Non influisce sul motore, sulla cartella setups/ o sugli altri tab connessi — è un reset puramente locale della vista. Utile quando il log diventa rumoroso e vuoi una finestra pulita sugli eventi successivi.",

    // ---------- Tooltips ----------
    "WebSocket connection between this browser and the engine process.\n\n• Connected — engine is running, live events streaming\n• Reconnecting — connection dropped; tab retries with backoff\n• Disconnected — engine process is down or unreachable":
      "Connessione WebSocket tra il browser e il processo del motore.\n\n• Connesso — motore in esecuzione, eventi in tempo reale\n• Riconnessione — connessione caduta; il tab ritenta con backoff\n• Disconnesso — processo motore non attivo o irraggiungibile",
    "Trading engine state machine.\n\n• idle — no setup loaded\n• watching — setup loaded, waiting for Entry 1\n• in_trade — at least one entry has filled\n• closed — trade finished for today\n• locked — daily lock active (one winning trade done) or DVS gate blocking trades":
      "Macchina a stati del motore.\n\n• inattivo — nessun setup caricato\n• in osservazione — setup caricato, in attesa di Entry 1\n• in trade — almeno un ingresso eseguito\n• chiuso — trade del giorno terminato\n• bloccato — lock giornaliero attivo (un trade vincente già chiuso) o gate DVS che blocca i trade",
    "Latest ES/US500 futures price the engine has seen from the broker feed.\n\nUpdates at most twice a second to keep the tab responsive.\n\nDashes mean no ticks yet (engine just started or feed disconnected).":
      "Ultimo prezzo ES/US500 ricevuto dal feed del broker.\n\nAggiornato al massimo due volte al secondo per non rallentare il tab.\n\nI trattini indicano che non sono ancora arrivati tick (motore appena avviato o feed disconnesso).",
    "Filename and key fields of the setup file the engine is currently operating on.\n\nShows 'None loaded' until one arrives.\n\nUpdates when a new setup is picked up from the setups/ folder or submitted through this form.":
      "Nome del file e campi principali del setup attualmente in uso dal motore.\n\nMostra 'Nessuno caricato' finché non ne arriva uno.\n\nSi aggiorna quando un nuovo setup viene preso dalla cartella setups/ o inviato tramite questo form.",
    "Every setup file loaded or rejected today.\n\nCount rises with each SIGNAL or INVALID event. The currently loaded setup is always shown even if it was loaded before this tab opened.\n\nClick to expand the list and see timestamps + filenames.\n\nResets when you reload the page — does not persist across tabs.":
      "Ogni file setup caricato o rifiutato oggi.\n\nIl contatore sale a ogni evento SIGNAL o INVALID. Il setup attualmente caricato viene sempre mostrato anche se era stato caricato prima dell'apertura di questo tab.\n\nClicca per espandere la lista con timestamp e nome file.\n\nSi azzera al ricaricamento della pagina — non persiste tra i tab.",
    "Upload one or more analyst chart screenshots (IV Smile / SPX intraday chart).\n\nTrident will run them through an AI vision model that extracts levels, ranges, DVS, and VWAP, then pre-fills this form so you can review and submit.\n\nCash last and basis are NOT extracted — the IV Smile's SPX feed is unreliable and may show 0.00. Enter those manually if needed.\n\nYou'll still get a chance to verify every value before it goes to the engine. Files are saved on the server for traceability.":
      "Carica uno o più screenshot dei grafici dell'analista (IV Smile / grafico SPX intraday).\n\nTrident li passerà a un modello AI di visione che estrae livelli, range, DVS e VWAP, poi precompila questo form per la revisione.\n\nCash last e basis NON vengono estratti — il feed SPX dell'IV Smile è inaffidabile e può mostrare 0.00. Inseriscili manualmente se necessario.\n\nAvrai sempre la possibilità di verificare ogni valore prima di inviarlo al motore. I file vengono salvati sul server per tracciabilità.",
    "Open a read-only view of what the engine is currently doing.\n\nShows: connection, state machine, daily lock, currently loaded setup (full values), and any open position.\n\nUseful while the form modal is closed.":
      "Apre una vista in sola lettura di ciò che il motore sta facendo in questo momento.\n\nMostra: connessione, macchina a stati, lock giornaliero, setup attualmente caricato (valori completi) e l'eventuale posizione aperta.\n\nUtile quando il form è chiuso.",
    "Clear the form to start a brand-new morning setup from scratch.\n\nResets every field, sets update_seq back to 1, and fills today's date.\n\nUse this once per trading day when FB sends the first setup of the session.":
      "Svuota il form per iniziare un nuovo setup del mattino da zero.\n\nResetta tutti i campi, riporta update_seq a 1 e imposta la data di oggi.\n\nUsalo una volta al giorno quando FB invia il primo setup della sessione.",
    "Keep the current values but bump update_seq by 1.\n\nThe submission is treated as an intra-day recalibration of an already-loaded setup (e.g. afternoon level refresh).\n\nEdit only the fields that changed, then submit — the engine swaps in the new levels without resetting trade state.":
      "Mantiene i valori correnti ma incrementa update_seq di 1.\n\nL'invio viene trattato come una ricalibrazione intra-day di un setup già caricato (es. aggiornamento livelli pomeridiano).\n\nModifica solo i campi cambiati e invia — il motore sostituisce i nuovi livelli senza resettare lo stato del trade.",
    "Load today's most recent setup file from the setups/ folder into the form.\n\nUseful if the page was reloaded or you want to inspect / tweak what the engine is currently running.\n\nDoes not submit — you still need to click Submit setup to push changes.":
      "Carica nel form l'ultimo setup di oggi dalla cartella setups/.\n\nUtile se hai ricaricato la pagina o vuoi ispezionare / modificare ciò che il motore sta eseguendo.\n\nNon invia — devi comunque cliccare Invia setup per applicare le modifiche.",
    "Trading date for this setup (YYYY-MM-DD). The engine rejects setups whose date isn't today.":
      "Data di trading di questo setup (YYYY-MM-DD). Il motore rifiuta setup con data diversa da oggi.",
    "Setup creation time. Picker shows your locale's format (AM/PM or 24-hour) but the value is always stored as 24-hour HH:MM. Used for the staleness check — the engine rejects setups older than ~6 hours.":
      "Ora di creazione del setup. Il selettore mostra il formato del tuo sistema (AM/PM o 24h) ma il valore viene sempre salvato come HH:MM 24h. Usato per il controllo di freschezza — il motore rifiuta setup più vecchi di circa 6 ore.",
    "1 for the morning setup. Bump to 2 (or higher) for an afternoon recalibration the same day. The engine uses this to distinguish a new setup from a level update.":
      "1 per il setup del mattino. Imposta 2 (o più) per una ricalibrazione pomeridiana dello stesso giorno. Il motore usa questo valore per distinguere un nuovo setup da un aggiornamento di livelli.",
    "Optional — audit trail only. Front-month ES futures contract code (e.g. ESM6 = June 2026, ESU6 = September 2026). The engine doesn't act on this value; it's stored in the YAML so you can tell months later which contract the setup was written against. Leave blank if you don't have it handy.":
      "Opzionale — solo per tracciabilità. Codice del contratto ES front-month (es. ESM6 = giugno 2026, ESU6 = settembre 2026). Il motore non usa questo valore; viene salvato nello YAML per poter sapere mesi dopo a quale contratto il setup faceva riferimento. Lascia vuoto se non lo hai a portata di mano.",
    "Most recent ES futures price at setup creation time.":
      "Ultimo prezzo ES futures al momento della creazione del setup.",
    "Most recent SPX cash index price at setup creation time. Used to cross-check basis.\n\nNot extracted from screenshots — the IV Smile's SPX feed can show 0.00 when unavailable. Enter manually if needed, or leave empty.":
      "Ultimo valore dell'indice SPX cash al momento della creazione del setup. Usato per verificare il basis.\n\nNon estratto dagli screenshot — il feed SPX dell'IV Smile può mostrare 0.00 se non disponibile. Inserisci manualmente se necessario, o lascia vuoto.",
    "ES–SPX spread: futures_last − cash_last. Recent range: 40–75 points.\n\nNot extracted from screenshots — the IV Smile's SPX feed is unreliable. Enter manually if needed, or leave empty.\n\nValidation (±5 check) is skipped when this field or Cash last is empty.":
      "Spread ES–SPX: futures_last − cash_last. Range recente: 40–75 punti.\n\nNon estratto dagli screenshot — il feed SPX dell'IV Smile è inaffidabile. Inserisci manualmente se necessario, o lascia vuoto.\n\nLa validazione (controllo ±5) viene saltata se questo campo o Cash last è vuoto.",
    "Which instrument the trade will actually be executed on. US500.cash = Pepperstone CFD.":
      "Strumento su cui verrà effettivamente eseguito il trade. US500.cash = CFD Pepperstone.",
    "Directional Volatility Score (0–200).\n\n• > 75 — DVS GATE blocks all trades today\n• 50–75 — normal range\n• < 50 — ideal mean-reversion conditions":
      "Directional Volatility Score (0–200).\n\n• > 75 — DVS GATE blocca tutti i trade oggi\n• 50–75 — range normale\n• < 50 — condizioni ideali per mean-reversion",
    "Yesterday's DVS. If today is lower than prior, volatility is compressing — conditions improving for mean-reversion. If higher, deteriorating.":
      "DVS di ieri. Se oggi è più basso, la volatilità si sta comprimendo — condizioni in miglioramento per il mean-reversion. Se più alto, in peggioramento.",
    "CBOE SKEW index reading. Measures tail-risk premium — higher means more downside protection being bought. Currently informational only.":
      "Lettura dell'indice CBOE SKEW. Misura il premio per il rischio di coda — più alto significa più protezione downside acquistata. Al momento solo informativo.",
    "Volatility regime label.\n\n• compressed — very low DVS\n• normal — 50–75\n• elevated / extreme — above 75\n\nShould match the DVS value.":
      "Etichetta del regime di volatilità.\n\n• compresso — DVS molto basso\n• normale — 50–75\n• elevato / estremo — sopra 75\n\nDeve essere coerente con il valore DVS.",
    "Volume-Weighted Average Price. The primary take-profit target for every Trident trade — every position is closed when VWAP is reached. Units pending FB confirmation; current best guess is ES futures.":
      "Volume-Weighted Average Price. È il target di take-profit principale per ogni trade Trident — ogni posizione viene chiusa al raggiungimento del VWAP. Unità in attesa di conferma da FB; ipotesi attuale: ES futures.",
    "Time when VWAP was last refreshed. Picker shows your locale's format (AM/PM or 24-hour) but the value is always stored as 24-hour HH:MM. A warning fires if older than ~90 minutes.":
      "Ora dell'ultimo aggiornamento del VWAP. Il selettore mostra il formato del tuo sistema (AM/PM o 24h) ma il valore viene salvato come HH:MM 24h. Compare un warning se più vecchio di circa 90 minuti.",
    "Where the VWAP number came from. manual = analyst typed it in from Bookmap / Excel.":
      "Da dove proviene il numero VWAP. manuale = inserito dall'analista da Bookmap / Excel.",
    "Outer upper boundary from the IV smile. Historical 75% re-entry rate — price comes back inside Range 1 three out of four times. Read off the LIVELLI table / IV Smile right panel — already in ES futures terms.":
      "Limite superiore esterno ricavato dall'IV smile. Tasso storico di rientro del 75% — il prezzo rientra nel Range 1 tre volte su quattro. Letto dalla tabella LIVELLI / pannello destro dell'IV Smile — già in termini ES futures.",
    "Inner upper boundary. Price spends most of its time between Range 2 up and Range 2 down. ES futures terms.":
      "Limite superiore interno. Il prezzo trascorre la maggior parte del tempo tra Range 2 sup e Range 2 inf. Termini ES futures.",
    "Inner lower boundary. Must satisfy: range_1_down < range_2_down < range_2_up < range_1_up. ES futures terms.":
      "Limite inferiore interno. Deve rispettare: range_1_down < range_2_down < range_2_up < range_1_up. Termini ES futures.",
    "Outer lower boundary from the IV smile. 75% re-entry rate. ES futures terms.":
      "Limite inferiore esterno ricavato dall'IV smile. Tasso di rientro del 75%. Termini ES futures.",
    "Time the levels were calculated. Picker shows your locale's format (AM/PM or 24-hour) but the value is always stored as 24-hour HH:MM. Optional — useful for traceability. Bump it when you submit a recal.":
      "Ora di calcolo dei livelli. Il selettore mostra il formato del tuo sistema (AM/PM o 24h) ma il valore viene salvato come HH:MM 24h. Opzionale — utile per tracciabilità. Aggiornalo quando invii una ricalibrazione.",
    "Outer resistance (Range 1 up from the IV Smile). Triggers Short Entry 3 — last / deepest scale-in on the short side. ES futures terms.":
      "Resistenza esterna (Range 1 up dall'IV Smile). Innesca Short Entry 3 — ultima/piu' profonda entrata sul lato short. Termini ES futures.",
    "Inner resistance (Range 2 up from the IV Smile). Triggers Short Entry 1 — the first touch that opens a short. Entry 2 is the midpoint of SELL OUTER and SELL INNER. ES futures terms.":
      "Resistenza interna (Range 2 up dall'IV Smile). Innesca Short Entry 1 — primo tocco che apre uno short. Entry 2 è il punto medio tra SELL OUTER e SELL INNER. Termini ES futures.",
    "Outer support (Range 1 down from the IV Smile). Triggers Long Entry 3 — last / deepest scale-in on the long side. ES futures terms.":
      "Supporto esterno (Range 1 down dall'IV Smile). Innesca Long Entry 3 — ultima/piu' profonda entrata sul lato long. Termini ES futures.",
    "Inner support (Range 2 down from the IV Smile). Triggers Long Entry 1 — the first touch that opens a long. Entry 2 is the midpoint of BUY INNER and BUY OUTER. ES futures terms.":
      "Supporto interno (Range 2 down dall'IV Smile). Innesca Long Entry 1 — primo tocco che apre un long. Entry 2 è il punto medio tra BUY INNER e BUY OUTER. Termini ES futures.",
    "Analyst's directional overlay.\n\n• neutral — watch both sides simultaneously; whichever Entry 1 is hit first becomes the trade (default)\n• long — only take long setups\n• short — only shorts":
      "Bias direzionale dell'analista.\n\n• neutro — osserva entrambi i lati contemporaneamente; il primo Entry 1 che si attiva diventa il trade (default)\n• long — solo setup long\n• short — solo short",
    "Free-text analyst reasoning. Stored with the setup but not acted on. Optional.":
      "Ragionamento dell'analista in testo libero. Salvato col setup ma non utilizzato. Opzionale.",
    "Switch language / Cambia lingua": "Cambia lingua / Switch language",
    'Help': 'Aiuto',

    // ---------- Help dialog ----------
    'Trident dashboard — quick reference': 'Cruscotto Trident — riferimento rapido',
    "A short summary of the buttons, the log tags, and the things that go wrong most often. For the full guide, open":
      "Un breve riepilogo dei pulsanti, dei tag di log e dei problemi più frequenti. Per la guida completa, apri",
    'Top buttons': 'Pulsanti principali',
    'Log tags': 'Tag del log',
    "If submission fails": "Se l'invio fallisce",
    'Tooltips': 'Tooltip',
    'Read-only snapshot of the engine right now — connection, state, daily lock, currently loaded setup, any open position.':
      'Istantanea in sola lettura del motore in questo momento — connessione, stato, lock giornaliero, setup attualmente caricato, eventuale posizione aperta.',
    'Open the form and start a fresh morning setup (resets every field, sets':
      'Apre il form e inizia un nuovo setup del mattino (resetta ogni campo, imposta',
    'to 1).': 'a 1).',
    'Open the form keeping the current values, with':
      'Apre il form mantenendo i valori attuali, con',
    'bumped — for an intra-day recalibration.':
      'incrementato — per una ricalibrazione intra-day.',
    "Load today's most recent setup file into the form so you can tweak only what's changed.":
      "Carica nel form il setup più recente di oggi così puoi modificare solo ciò che è cambiato.",
    'Upload one IV Smile chart screenshot. If AI is configured, Trident extracts BUY INNER/OUTER and SELL INNER/OUTER levels, ranges, DVS, and VWAP from the range panel and pre-fills the form. Cash last and basis are not extracted — enter manually if needed.':
      "Carica uno screenshot del grafico IV Smile. Se l'AI è configurata, Trident estrae i livelli BUY INNER/OUTER e SELL INNER/OUTER, range, DVS e VWAP dal pannello dei range e precompila il form. Cash last e basis non vengono estratti — inseriscili manualmente se necessario.",
    'Always review every value': 'Verifica sempre ogni valore',
    'before submitting.': 'prima di inviare.',
    'Anything with': 'Tutto ciò che contiene',
    'needs you to do something at the broker. The rest is informational.':
      "richiede un'azione al broker. Il resto è informativo.",
    'Setup file accepted and loaded.': 'File setup accettato e caricato.',
    'Setup file failed validation. The error list says which rule broke.':
      'File setup non superato dalla validazione. La lista degli errori indica quale regola si è rotta.',
    'Setup loaded with warnings (e.g. stale VWAP). Still trading.':
      'Setup caricato con warning (es. VWAP vecchio). Continua a tradare.',
    'DVS > 75 — no trades today. Engine stays idle.':
      'DVS > 75 — nessun trade oggi. Il motore resta inattivo.',
    'Trade plan ready. Engine is now watching for Entry 1.':
      'Piano di trade pronto. Il motore osserva per Entry 1.',
    "Bias + your levels don't give a valid trade.":
      'Bias + i tuoi livelli non producono un trade valido.',
    'Open / scale into the position at the stated size and stop.':
      'Apri / scala nella posizione con la size e lo stop indicati.',
    'Move your broker stop to the stated level; cancel any unfilled entry orders.':
      'Sposta lo stop al broker al livello indicato; cancella eventuali ordini di entrata non eseguiti.',
    'Exit at the broker. Reason is printed (vwap_hit, stop_loss, time_exit, hard_profit_exit).':
      'Esci al broker. Il motivo viene stampato (vwap_hit, stop_loss, time_exit, hard_profit_exit).',
    'One winning trade done — no more trades today.':
      'Un trade vincente chiuso — nessun altro trade oggi.',
    'Fields outlined in red show exactly what\'s wrong. Most common causes:':
      "I campi evidenziati in rosso mostrano esattamente il problema. Cause più comuni:",
    'Required levels are missing': 'Livelli richiesti mancanti',
    'Provide both BUY OUTER+INNER or both SELL OUTER+INNER (or both pairs).':
      'Fornisci sia BUY OUTER+INNER sia SELL OUTER+INNER (o entrambe le coppie).',
    'Range / level ordering invalid':
      'Ordine di range / livelli non valido',
    'Check the inequalities printed in the error message.':
      "Controlla le disuguaglianze stampate nel messaggio di errore.",
    'Basis math mismatch': 'Basis math non coerente',
    'must be within ±5 of the basis you entered. This check is skipped if Cash last or Basis is left empty.':
      'deve corrispondere entro ±5 al basis inserito. Il controllo viene saltato se Cash last o Basis è vuoto.',
    'Every field has an': 'Ogni campo ha un',
    'icon — hover for a per-field explanation.':
      'icona — passaci sopra per una spiegazione del campo.',

    // ---------- Confirm dialog ----------
    'Confirm setup submission': 'Conferma invio setup',
    'Review the values below before they go to the engine.':
      'Rivedi i valori prima di inviarli al motore.',
    'Back to edit': 'Torna a modificare',
    'Engine state right now': 'Stato del motore in questo momento',
    'Connection': 'Connessione',
    'Engine state': 'Stato motore',
    'Daily lock': 'Lock giornaliero',
    'Locked — no more trades today': 'Bloccato — nessun altro trade oggi',
    'Not locked': 'Non bloccato',
    'Open position': 'Posizione aperta',
    'avg entry': 'entrata media',
    'stop': 'stop',
    'fill(s)': 'entrata/e',
    'BE': 'BE',
    'Engine is offline — file will sit in setups/ until it reconnects.':
      'Motore offline — il file resterà in setups/ finché non si riconnette.',
    'Engine is locked for today — setup stored but no trades will fire until tomorrow.':
      'Motore bloccato per oggi — setup salvato ma nessun trade verrà aperto fino a domani.',
    'Engine is blocked by the DVS gate — submission stored, but trading is off today.':
      'Motore bloccato dal DVS gate — setup salvato, ma il trading è disattivato oggi.',
    'Updating levels of in-flight {dir} (seq {old} → {new}) — engine will recompute stops and entries.':
      'Aggiornamento livelli della posizione {dir} in corso (seq {old} → {new}) — il motore ricalcolerà stop e ingressi.',
    'Recalibration of current setup (seq {old} → {new}) — engine will swap in new levels.':
      'Ricalibrazione del setup corrente (seq {old} → {new}) — il motore sostituirà i nuovi livelli.',
    'Engine is in a trade — submitting a fresh setup here would replace what it is currently working on.':
      'Il motore è in trade — inviare un nuovo setup qui sostituirebbe quello su cui sta lavorando.',
    'Engine will load this as the active setup and start watching for Entry 1.':
      'Il motore caricherà questo come setup attivo e inizierà a osservare per Entry 1.',
    'Setup summary': 'Riepilogo setup',
    'Date / time': 'Data / ora',
    'Futures / Cash / Basis': 'Futures / Cash / Basis',
    'DVS / regime': 'DVS / regime',
    'Ranges (ES futures)': 'Range (ES futures)',
    'Levels (ES futures)': 'Livelli (ES futures)',
    'PRD sanity checks': 'Controlli PRD',
    'Basis matches futures − cash': 'Basis coerente con futures − cash',
    'Basis disagrees with futures − cash by more than 5 points':
      'Basis differisce da futures − cash di più di 5 punti',
    'Range ordering correct': 'Ordine dei range corretto',
    'Range ordering broken': 'Ordine dei range non valido',
    'Expected: range_1_down < range_2_down < range_2_up < range_1_up':
      'Atteso: range_1_down < range_2_down < range_2_up < range_1_up',
    'Level ordering correct': 'Ordine dei livelli corretto',
    'Level ordering broken': 'Ordine dei livelli non valido',
    'Expected: BUY OUTER < BUY INNER < SELL INNER < SELL OUTER':
      'Atteso: BUY OUTER < BUY INNER < SELL INNER < SELL OUTER',
    'No tradeable level pair — engine will not enter':
      'Nessuna coppia di livelli operativa — il motore non entrerà',
    'Provide both BUY OUTER+INNER or both SELL OUTER+INNER.':
      'Fornisci sia BUY OUTER+INNER sia SELL OUTER+INNER (almeno una coppia).',
    'Only one side has levels — engine will trade that side only':
      'Solo un lato ha livelli — il motore tradera solo quel lato',
    'DVS above 75 — gate will block all trades today':
      'DVS sopra 75 — il gate bloccherà tutti i trade oggi',
    'DVS below 50 — ideal mean-reversion conditions':
      'DVS sotto 50 — condizioni ideali per mean-reversion',
    'DVS in normal range (50–75)': 'DVS in range normale (50–75)',
    'VWAP older than 90 minutes vs setup time':
      'VWAP più vecchio di 90 minuti rispetto al timestamp del setup',
    'VWAP fresh (≤90 min)': 'VWAP fresco (≤90 min)',
    'Levels summary (ES futures)':
      'Riepilogo livelli (ES futures)',
    'Date is not today — engine will reject': 'La data non è oggi — il motore rifiuterà',

    // ---------- Form / Status modal chrome ----------
    'Setup form': 'Form setup',
    'Current status': 'Stato corrente',
    "A read-only snapshot of the engine and the setup it's operating on right now.":
      'Istantanea in sola lettura del motore e del setup su cui sta operando.',
    'Close': 'Chiudi',
    'Currently loaded setup': 'Setup attualmente caricato',
    'No setup loaded today.': 'Nessun setup caricato oggi.',

    // ---------- Trade plan note ----------
    'No bias set — defaulting to long.': 'Bias non impostato — di default long.',
    'Bias: long.': 'Bias: long.',
    'Bias: short.': 'Bias: short.',
    'Bias: neutral — watching both sides, first trigger wins.': 'Bias: neutro — osserva entrambi i lati, il primo trigger vince.',
    'Bias: neutral — one side only (incomplete level pair on the other side).': 'Bias: neutro — solo un lato (coppia di livelli incompleta sull\'altro lato).',
    'Buy entry: watching for {price} BUY INNER (Entry 1)': 'Ingresso long: in attesa di {price} BUY INNER (Entry 1)',
    'Sell entry: watching for {price} SELL INNER (Entry 1)': 'Ingresso short: in attesa di {price} SELL INNER (Entry 1)',
    '{price} mid (Entry 2, derived)': '{price} mid (Entry 2, derivato)',
    '{price} BUY OUTER (Entry 3)': '{price} BUY OUTER (Entry 3)',
    '{price} SELL OUTER (Entry 3)': '{price} SELL OUTER (Entry 3)',
    'engine enters long.': 'motore entra long.',
    'engine enters short.': 'motore entra short.',
    'Stop': 'Stop',
    'pre-trade estimate': 'stima pre-trade',
    'worst case if all 3 fill': 'caso peggiore (tutte e 3 le entrate)',
    'single entry': 'singola entrata',
    'pts from avg entry': 'pt dalla media entrate',
    'ℹ️ Once in a trade the status panel shows the live stop.':
      'ℹ️ Durante il trade il pannello stato mostra lo stop live.',
    'Profit target: VWAP at {vwap} — entire position closes when price reaches VWAP.':
      'Target profitto: VWAP a {vwap} — la posizione si chiude interamente al raggiungimento del VWAP.',
    'below {price}': 'sotto {price}',
    'above {price}': 'sopra {price}',
    'Void if price {levels} before entry': 'Invalido se prezzo {levels} prima dell\'ingresso',
    ' or ': ' o ',

    // ---------- AI extraction banner ----------
    'AI extraction unavailable': 'Estrazione AI non disponibile',
    'AI extraction failed': 'Estrazione AI fallita',
    'AI pre-fill complete — please review every field before submitting.':
      'Precompilazione AI completata — controlla ogni campo prima di inviare.',
    'Screenshots saved on the server. AI provider is not configured — fill the form manually.':
      'Screenshot salvati sul server. Provider AI non configurato — compila il form manualmente.',
    'Screenshots uploaded. AI extraction unavailable.':
      'Screenshot caricati. Estrazione AI non disponibile.',
    'AI extraction failed — fill the form manually.':
      'Estrazione AI fallita — compila il form manualmente.',
    'Form pre-filled from screenshots.': 'Form precompilato dagli screenshot.',
    'Extraction details': 'Dettagli estrazione',
    'Only one screenshot is supported — upload the IV Smile chart.':
      'È supportato un solo screenshot — carica il grafico IV Smile.',
    'Uploading screenshot…': 'Caricamento screenshot…',
    'Sending image to the server.': 'Invio immagine al server.',
    'AI is reading the screenshot…': "L'AI sta leggendo lo screenshot…",
    'Extracting BUY/SELL levels, ranges, DVS, and VWAP. This usually takes 5–20 seconds.':
      'Estrazione livelli BUY/SELL, range, DVS e VWAP. In genere richiede 5–20 secondi.',
  },
};
