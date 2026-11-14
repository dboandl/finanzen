// Kernlogik der Finanzen-App: Exporte lesen, Klienten anonymisieren, Buchungen kategorisieren, Monate auswerten.
// Läuft im Browser (App) und in Node 18+ (tools/anonymisieren.js, tools/kategorisieren.js, Tests).
// Hier steht nichts Persönliches: persönliche Regeln, Namen von Kategorien wie "Kinder" → echter Name usw.
// kommen aus den privaten Daten (Repo finanzen-daten), die Liste Name ↔ Kürzel nur vom Handy.
(function (root) {
  'use strict';

  // ---------- Kategorien ----------
  // kind: aus = Ausgabe, ein = Einnahme, topf = Verrechnungstopf (eigene Netto-Rechnung, nicht in Ausgaben),
  //       invest = Wertpapiere, umbuchung = zwischen eigenen Konten, versteckt = taucht nirgends auf.
  const DEFAULT_GROUPS = [
    { id: 'lebensmittel', name: 'Lebensmittel', kind: 'aus', cats: [['supermarkt', 'Supermarkt'], ['baeckerei', 'Bäckerei']] },
    { id: 'essen', name: 'Essen gehen', kind: 'aus', cats: [['restaurant', 'Restaurant & Lieferung'], ['fastfood', 'Fast Food'], ['cafe', 'Café & Eis']] },
    { id: 'auto', name: 'Auto', kind: 'aus', cats: [['tanken', 'Tanken'], ['maut', 'Maut & Vignette'], ['parken', 'Parken'], ['versicherung', 'Versicherung'], ['werkstatt', 'Werkstatt & Service']] },
    { id: 'oeffis', name: 'Öffis', kind: 'aus', cats: [['bahn', 'Bahn'], ['stadtverkehr', 'Stadtverkehr']] },
    { id: 'wohnen', name: 'Wohnen', kind: 'aus', cats: [['miete', 'Miete'], ['energie', 'Strom & Gas'], ['betriebskosten', 'Betriebskosten'], ['kredit', 'Kredit'], ['versicherung', 'Haushaltsversicherung'], ['einrichtung', 'Einrichtung & Baumarkt'], ['reparaturen', 'Reparaturen']] },
    { id: 'kinder', name: 'Kinder', kind: 'aus', cats: [['betreuung', 'Betreuung'], ['ausgaben', 'Ausgaben'], ['spielzeug', 'Spielzeug & Freizeit']] },
    { id: 'versicherungen', name: 'Versicherungen', kind: 'aus', cats: [['kranken', 'Kranken'], ['leben', 'Leben'], ['sonstige', 'Sonstige']] },
    { id: 'kommunikation', name: 'Kommunikation & Abos', kind: 'aus', cats: [['handy', 'Handy & Internet'], ['abos', 'Abos']] },
    { id: 'gesundheit', name: 'Gesundheit & Drogerie', kind: 'aus', cats: [['arzt', 'Arzt & Apotheke'], ['drogerie', 'Drogerie']] },
    { id: 'sport', name: 'Sport', kind: 'aus', cats: [['fitness', 'Fitnessstudio'], ['baeder', 'Bäder & Klettern'], ['vereine', 'Vereine']] },
    { id: 'freizeit', name: 'Freizeit & Urlaub', kind: 'aus', cats: [['urlaub', 'Urlaub & Hotel'], ['ausfluege', 'Ausflüge & Kino'], ['hobby', 'Bücher & Hobby']] },
    { id: 'shopping', name: 'Shopping', kind: 'aus', cats: [['kleidung', 'Kleidung'], ['online', 'Online'], ['sonstiges', 'Sonstiges']] },
    { id: 'paypal', name: 'PayPal', kind: 'aus', cats: [['paypal', 'PayPal (nicht aufgeschlüsselt)']] },
    { id: 'amazon', name: 'Amazon Visa', kind: 'aus', cats: [['amazon', 'Amazon Visa (nicht aufgeschlüsselt)']] },
    { id: 'ausbildung', name: 'Ausbildung', kind: 'aus', cats: [['psychotherapie', 'Psychotherapie'], ['sonstiges', 'Sonstiges']] },
    { id: 'selbststaendig', name: 'Selbstständigkeit', kind: 'aus', cats: [['svs', 'SVS'], ['wko', 'Wirtschaftskammer'], ['steuern', 'Steuern'], ['sonstiges', 'Sonstiges']] },
    { id: 'bargeld', name: 'Bargeld', kind: 'aus', cats: [['bargeld', 'Bargeld']] },
    { id: 'gebuehren', name: 'Gebühren', kind: 'aus', cats: [['gebuehren', 'Gebühren & Zinsen']] },
    { id: 'sonstiges', name: 'Sonstiges', kind: 'aus', cats: [['sonstiges', 'Sonstiges']] },
    { id: 'einnahmen', name: 'Einnahmen', kind: 'ein', cats: [['gehalt', 'Gehalt'], ['klienten', 'Klienten'], ['sonstiges', 'Sonstiges'], ['einmalig', 'Einmalig']] },
    { id: 'invest', name: 'Investment', kind: 'invest', cats: [['invest', 'Wertpapiere']] },
    { id: 'umbuchung', name: 'Umbuchung', kind: 'umbuchung', cats: [['umbuchung', 'Eigene Konten & Sparen']] },
    { id: 'versteckt', name: 'Ausgeblendet', kind: 'versteckt', cats: [['versteckt', 'Ausgeblendet']] },
  ];
  const KIND_NAMES = { aus: 'Ausgaben', ein: 'Einnahmen', topf: 'Verrechnungstöpfe', invest: 'Investment', umbuchung: 'Umbuchung', versteckt: 'Ausgeblendet' };

  // overlay (privat, settings/categories): { rename: { 'kinder': 'Max', 'einnahmen/gehalt': 'Firma X' },
  //   addGroups: [{ id, name, kind, cats: [[id, name]] }], addCats: { gruppe: [[id, name]] } }
  function buildCats(overlay) {
    const ov = overlay || {};
    const groups = DEFAULT_GROUPS.map(g => ({ ...g, cats: g.cats.map(c => [...c]) }));
    for (const g of ov.addGroups || []) {
      if (groups.some(x => x.id === g.id)) continue;
      const at = groups.findIndex(x => x.kind !== 'aus' && g.kind === 'aus') ;
      const ng = { id: g.id, name: g.name, kind: g.kind || 'aus', cats: (g.cats || []).map(c => [...c]) };
      if (at >= 0) groups.splice(at, 0, ng); else groups.push(ng);
    }
    for (const [gid, cats] of Object.entries(ov.addCats || {})) {
      const g = groups.find(x => x.id === gid); if (!g) continue;
      for (const c of cats) if (!g.cats.some(x => x[0] === c[0])) g.cats.push([...c]);
    }
    const byCat = {}, byGroup = {};
    for (const g of groups) {
      if (ov.rename && ov.rename[g.id]) g.name = ov.rename[g.id];
      byGroup[g.id] = g;
      for (const c of g.cats) {
        const id = g.id + '/' + c[0];
        if (ov.rename && ov.rename[id]) c[1] = ov.rename[id];
        byCat[id] = { id, name: c[1], group: g.id, groupName: g.name, kind: g.kind };
      }
    }
    return { groups, byCat, byGroup };
  }

  // ---------- Allgemeine Regeln (für jeden gleich, deshalb öffentlich) ----------
  // Bedingungen einer Regel (alle müssen passen): text (Regex auf Partner + Referenz + Buchungstext),
  // party (Regex auf Partner), ref (Regex auf Referenz), iban (genau), type (Regex auf Buchungsart),
  // mcc (Liste), card (true = Kartenzahlung), sign ('+' Eingang, '-' Ausgang), src ('bank99' | 'tr').
  // month: 'ref' = Monat aus der Referenz ("Gehalt 10/2026") statt aus dem Buchungsdatum.
  const R = (cat, cond) => ({ cat, ...cond });
  const SEED_RULES = [
    R('umbuchung/umbuchung', { type: '^SB Konto [ÜU]bertrag' }),
    R('invest/invest', { type: '^(BUY|SELL|EARNINGS|DIVIDEND|SAVINGS_PLAN|SPLIT)' }),
    R('einnahmen/sonstiges', { type: '^(INTEREST_PAYMENT|BENEFITS_SAVEBACK|BENEFITS_ROUND_UP)' }),
    R('bargeld/bargeld', { type: 'beheb' }),
    R('bargeld/bargeld', { text: '^BANKOMAT \\d|\\bATM\\b' }),
    R('paypal/paypal', { text: 'PAYPAL' }),
    R('amazon/amazon', { text: 'AMAZON|AMZN' }),
    R('essen/fastfood', { text: 'IKEA', mcc: ['5814', '5812'] }),
    R('lebensmittel/supermarkt', { card: true, text: '\\b(HOFER|BILLA|SPAR|INTERSPAR|EUROSPAR|LIDL|PENNY|KAUFLAND|MERKUR|MPREIS|UNIMARKT|NAH ?& ?FRISCH|ADEG|MIX MARKT|PLODINE|KONZUM|STUDENAC|TOMMY|MERCATOR|ALDI|REWE|EDEKA|NETTO|PAMIR MARKET)(?![A-ZÄÖÜ])' }),
    R('lebensmittel/baeckerei', { card: true, text: 'B[AÄ]E?CKEREI|BACKWERK|DITSCH|\\bANKER\\b|\\bFELBER\\b|STR[OÖ]E?CK' }),
    R('essen/fastfood', { card: true, text: 'MCDONALD|BURGER KING|\\bKFC\\b|SUBWAY|NORDSEE|DOMINO|KEBAB|IMBISS|D[OÖ]E?NER' }),
    R('essen/restaurant', { text: 'VELOFOOD|LIEFERANDO|FOODORA|MJAM|\\bWOLT\\b' }),
    R('essen/restaurant', { card: true, text: '^U\\.O\\. |\\bRESTAURANT\\b|PIZZERIA|TRATTORIA|GASTHAUS|GASTHOF|HEURIGER|\\bKITC' }),
    R('essen/cafe', { card: true, text: '\\bCAF[EÉ]\\b|CAFFE|COFFEE|STARBUCKS|EISSALON|\\bEIS\\b|GELATERIA' }),
    R('auto/tanken', { card: true, text: '\\b(OMV|ENI|AGIP|BP|SHELL|JET|TURM[OÖ]E?L|DISKONT|AVIA|DOPPLER|GENOL|ROTH ENERGIE|MOL|PETROL|TANKSTELLE|ESSO|ARAL|TOTAL)\\b' }),
    R('auto/maut', { text: 'ASFINAG|VIGNETTE|\\bMAUT\\b|\\bHAC\\b|\\bDARS\\b' }),
    R('auto/parken', { card: true, text: 'PARKGARAGE|GARAGE|PARKEN|PARKING|APCOA|EASYPARK|HANDYPARKEN|CONTIPARK' }),
    R('auto/werkstatt', { text: '[OÖ]E?AMTC|ARB[OÖ]E?\\b|WERKSTATT|REIFEN|PICKERL|FORSTINGER|VERG[OÖ]E?LST|PITSTOP' }),
    R('oeffis/bahn', { text: '[OÖ]E?BB|WESTBAHN|DEUTSCHE BAHN|RAILJET|NIGHTJET' }),
    R('oeffis/stadtverkehr', { text: 'WIENER LINIEN|STRA.?.?ENBAHN|GRAZ LINIEN|VERKEHRSVERBUND|\\bDPP\\b|\\bBVG\\b|\\bUBER\\b|\\bBOLT\\b|TAXI' }),
    R('wohnen/einrichtung', { card: true, text: 'IKEA|M[OÖ]E?BELIX|M[OÖ]E?MAX|XXXLUTZ|KIKA|LEINER|\\bOBI\\b|BAUHAUS|HORNBACH|HAGEBAU|LAGERHAUS|JYSK|DEPOT|THOMAS PHILIPPS' }),
    R('wohnen/energie', { text: '[OÖ]E?KOSTROM|WIEN ENERGIE|ENERGIE STEIERMARK|ENERGIE GRAZ|VERBUND AG|\\bEVN\\b|KELAG|SALZBURG AG|LINZ AG' }),
    R('kommunikation/handy', { text: 'A1 TELEKOM|MAGENTA|T-MOBILE|HUTCHISON|\\bDREI\\b|SPUSU|YESSS|HOT TELEKOM|LIWEST|KABELPLUS' }),
    R('kommunikation/abos', { text: 'AUDIBLE|SPOTIFY|NETFLIX|DISNEY|APPLE\\.COM|GOOGLE \\*|YOUTUBE|PRIME VIDEO|DAZN|\\bSKY\\b|OPENAI|ANTHROPIC|CLAUDE\\.AI|MICROSOFT|ADOBE|DROPBOX|ICLOUD' }),
    R('gesundheit/drogerie', { card: true, text: '\\bDM\\b|DM-FIL|M[UÜ]E?LLER|\\bBIPA\\b|ROSSMANN|DOUGLAS|MARIONNAUD' }),
    R('gesundheit/arzt', { text: 'APOTHEKE|ORDINATION|ZAHNARZT|\\bARZT\\b' }),
    R('sport/fitness', { text: 'FITINN|FIT INN|SPEED FITNESS|JOHN HARRIS|MCFIT|CLEVER FIT|INJOY|URBAN SPORTS' }),
    R('sport/baeder', { card: true, text: 'BAD\\b|B[AÄ]E?DER|THERME|HALLENBAD|FREIBAD|BOULDER|KLETTER|\\bBLOC\\b' }),
    R('freizeit/hobby', { card: true, text: 'THALIA|LIBRO|MORAWA|HUGENDUBEL|PAGRO|BOESNER|STEAM|PLAYSTATION|NINTENDO' }),
    R('freizeit/ausfluege', { card: true, text: '\\bKINO\\b|CINEPLEXX|CINEMAXX|MUSEUM|HAUS DES MEERES|AQUAPARK|TIERGARTEN|[OÖ]E?TICKET' }),
    R('freizeit/urlaub', { text: 'BOOKING\\.COM|AIRBNB|EXPEDIA|\\bHOTEL\\b' }),
    R('shopping/kleidung', { card: true, text: 'H&M|\\bHM AT|NEW ?YORKER|\\bZARA\\b|C&A|PRIMARK|\\bKIK\\b|DEICHMANN|HUMANIC|LEDER ?&? +SCHUH|TK ?MAXX|PEEK|SNIPES|ZALANDO|ABOUT YOU|INTERSPORT|HERVIS|DECATHLON' }),
    R('shopping/online', { text: '\\bTEMU\\b|TEMU\\.COM|SHEIN|ALIEXPRESS|WILLHABEN|EBAY|ETSY|GALAXUS' }),
    R('sonstiges/sonstiges', { card: true, text: 'TABAK|TRAFIK' }),
    R('freizeit/urlaub', { card: true, text: 'CAMPING' }),
    R('selbststaendig/svs', { text: 'SOZIALVERS.*SELBST|\\bSVS\\b' }),
    R('selbststaendig/wko', { text: 'WIRTSCHAFTSKAMMER|\\bWKO\\b' }),
    R('einnahmen/sonstiges', { sign: '+', text: 'FINANZAMT|\\bFA [OÖ]E?STERREICH' }),
    R('selbststaendig/steuern', { sign: '-', text: 'FINANZAMT|\\bFA [OÖ]E?STERREICH' }),
    R('versicherungen/sonstige', { sign: '-', text: 'VERSICHERUNG|UNIQA|GENERALI|ALLIANZ|GRAWE|ZURICH|\\bVAV\\b|\\bERGO\\b|HELVETIA|WIENER ST[AÄ]E?DTISCHE' }),
    R('gebuehren/gebuehren', { sign: '-', text: 'KONTOF[UÜ]E?HRUNG|ENTGELT|SPESEN|KARTENGEB' }),
  ];
  SEED_RULES.forEach((r, i) => { r.id = 'seed-' + i; r.seed = true; });

  // Händlerkategorie (MCC) der Kartenzahlung, wenn keine Regel gepasst hat.
  const MCC = {};
  const mcc = (cat, codes) => codes.forEach(c => { MCC[c] = cat; });
  mcc('lebensmittel/supermarkt', ['5411', '5422', '5441', '5451', '5499']);
  mcc('lebensmittel/baeckerei', ['5462']);
  mcc('essen/restaurant', ['5812', '5813']);
  mcc('essen/fastfood', ['5814']);
  mcc('auto/tanken', ['5541', '5542', '5983', '5172', '5552']);
  mcc('auto/maut', ['4784']);
  mcc('auto/parken', ['7523']);
  mcc('auto/werkstatt', ['5531', '5532', '5533', '7531', '7534', '7538', '7542', '7549']);
  mcc('oeffis/stadtverkehr', ['4111', '4121', '4131']);
  mcc('oeffis/bahn', ['4112']);
  mcc('freizeit/urlaub', ['4411', '4511', '4582', '4722', '7011', '7012', '7033']);
  mcc('wohnen/einrichtung', ['5200', '5211', '5231', '5251', '5261', '5712', '5713', '5714', '5719']);
  mcc('gesundheit/drogerie', ['5912', '5977']);
  mcc('gesundheit/arzt', ['5122', '8011', '8021', '8031', '8041', '8042', '8043', '8049', '8050', '8062', '8071', '8099']);
  mcc('shopping/kleidung', ['5611', '5621', '5631', '5641', '5651', '5655', '5661', '5681', '5691', '5697', '5698', '5699', '5931']);
  mcc('freizeit/hobby', ['5942', '5943', '5945', '5970', '5971', '5994']);
  mcc('freizeit/ausfluege', ['7832', '7922', '7991', '7996', '7998', '7999']);
  mcc('sport/fitness', ['7997', '7941']);
  mcc('sport/baeder', ['7032']);
  mcc('kommunikation/abos', ['4899', '5815', '5816', '5817', '5818']);
  mcc('kommunikation/handy', ['4814']);
  mcc('shopping/sonstiges', ['5300', '5310', '5311', '5331', '5399', '5732', '5734', '5722', '5964', '5995', '5999', '5947', '5992']);
  mcc('ausbildung/sonstiges', ['8211', '8220', '8241', '8244', '8249', '8299']);
  mcc('bargeld/bargeld', ['6010', '6011']);
  mcc('sonstiges/sonstiges', ['4900', '5993', '6513', '7221', '9211', '9222', '9311', '9399']);

  // ---------- Hilfsfunktionen ----------
  const squash = s => String(s || '').replace(/\s+/g, ' ').trim();
  // 53-bit-Hash (cyrb53), synchron in Browser und Node. Für Duplikat-Erkennung und den IBAN-Fingerabdruck.
  function hash(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  const deNum = s => { const t = String(s || '').trim(); if (!t) return 0; return Number(t.replace(/\./g, '').replace(',', '.')); };
  const num = s => { const t = String(s || '').trim(); return t ? Number(t) : 0; };
  const round2 = n => Math.round(n * 100) / 100;

  // Bytes → Text. bank99 schreibt ISO-8859-1, Trade Republic UTF-8.
  function decodeBytes(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u).replace(/^\uFEFF/, ''); }
    catch { return new TextDecoder('windows-1252').decode(u); }
  }

  // CSV mit Anführungszeichen; Trennzeichen wird aus der Kopfzeile erkannt.
  function parseCSV(text) {
    const first = text.slice(0, text.search(/\r?\n/) >>> 0 || text.length);
    const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = ''; if (row.some(x => x !== '')) rows.push(row); row = [];
      } else f += c;
    }
    row.push(f); if (row.some(x => x !== '')) rows.push(row);
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? '' : r[i]])));
  }

  function detect(text) {
    const head = text.slice(0, 2000);
    if (/Buchungsdatum/.test(head) && /Betrag/.test(head) && /Umsatztext/.test(head)) return 'bank99';
    if (/transaction_id/.test(head) && /mcc_code/.test(head)) return 'tr';
    return null;
  }

  // Händler aus dem bank99-Umsatztext von Kartenzahlungen ("HOFER DANKT 2361 K3 08.06.UM 08:10",
  // "AT 60,00 POS 14.08.26 17:04 K3 WELL WELT CAMP").
  function b99Merchant(text) {
    let m = text.match(/^AT\s+[\d.,]+\s+(?:POS|ATM)\s+\d\d\.\d\d\.\d\d\s+\d\d:\d\d\s+K\d+\s+(.+)$/);
    if (m) return m[1].trim();
    m = text.match(/^(.*?)\s+K\d+\s+\d\d\.\d\d\.UM\s+\d\d:\d\d/);
    if (m) return m[1].trim();
    return text.slice(0, 60);
  }

  // Einheitliche Form einer Buchung:
  // { id, src, acct, date, amt, party, iban, ref, text, type, mcc, card, asset? }
  function normBank99(r) {
    const text = squash(r['Umsatztext']);
    const type = squash(r['Buchungstext']);
    const card = /^POS|Debitkarte|beheb/i.test(type) || /\bK\d+\s+\d\d\.\d\d\.UM\b|\b(POS|ATM)\s+\d\d\.\d\d\.\d\d/.test(text);
    let party = squash(r['Name des Partners']) || squash(r['Name des ultimate Partners']);
    if (!party) party = card ? b99Merchant(text) : text.slice(0, 60);
    const ref = [r['Zahlungsreferenz'], r['Verwendungszweck']].map(squash).filter(Boolean).join(' · ');
    const iban = squash(r['Kontoverbindung des Partners']).replace(/\s/g, '');
    const acct = squash(r['IBAN']).replace(/\s/g, '');
    const key = [acct, r['Umsatzzeit'], r['Betrag'], type, r['Zahlungsreferenz'], iban, r['Buchungsdatum']].join('|');
    return { id: 'b' + hash(key) + hash(key, 7), src: 'bank99', acct, date: squash(r['Buchungsdatum']), amt: round2(deNum(r['Betrag'])),
      party, iban, ref, text, type, mcc: '', card };
  }
  function normTR(r) {
    const type = squash(r['type']);
    const amt = round2(num(r['amount']) + num(r['fee']) + num(r['tax']));
    const tx = { id: 't' + squash(r['transaction_id']), src: 'tr', acct: 'TR', date: squash(r['date']), amt,
      party: squash(r['name']) || squash(r['counterparty_name']) || squash(r['description']).slice(0, 60),
      iban: squash(r['counterparty_iban']).replace(/\s/g, ''), ref: squash(r['payment_reference']), text: squash(r['description']),
      type, mcc: squash(r['mcc_code']), card: /^CARD_/.test(type) };
    if (r['symbol']) tx.asset = squash(r['symbol']);
    if (!r['transaction_id']) tx.id = 't' + hash([r['datetime'], r['amount'], r['description']].join('|'));
    return tx;
  }

  function parseExport(text) {
    const fmt = detect(text);
    if (!fmt) return { fmt: null, txs: [] };
    const rows = parseCSV(text);
    const txs = rows.map(fmt === 'bank99' ? normBank99 : normTR).filter(t => /^\d{4}-\d\d-\d\d$/.test(t.date) && Number.isFinite(t.amt));
    return { fmt, txs };
  }

  // ---------- Anonymisierung ----------
  // Klient = "MGT" in Referenz oder Text, oder IBAN schon als Klient bekannt.
  // priv (nur auf dem Handy / nur im Speicher des Mac-Skripts):
  //   { salt, people: { kürzel: { name, kind: 'client'|'person' } }, keys: { fingerabdruck: kürzel } }
  const CLIENT_RE = /\bMGT\b/i;
  const TITLES = new Set(['mag', 'maga', 'mmag', 'dr', 'dra', 'di', 'dipl', 'ing', 'dipling', 'msc', 'bsc', 'ma', 'ba', 'mba', 'phd', 'prof', 'dkfm', 'med', 'univ', 'rer', 'nat', 'fh', 'bed', 'mas', 'llm', 'jur', 'hon', 'herr', 'frau', 'fam', 'familie']);
  function nameTokens(name) {
    return String(name || '').replace(/\(.*?\)/g, ' ').split(/[\s,]+/)
      .map(t => t.replace(/[.\-]+$/g, ''))
      .filter(t => t && !TITLES.has(t.toLowerCase().replace(/[^a-zäöüß]/g, '')) && /[A-Za-zÄÖÜäöüß]/.test(t));
  }
  // Gleich für "Anna Muster", "MUSTER ANNA", "Mag. Anna Muster".
  const nameKey = name => nameTokens(name).map(t => t.toLowerCase()).sort().join(' ');
  function initials(name) {
    const t = nameTokens(name);
    if (!t.length) return 'XX';
    const first = t[0], last = t.length > 1 ? t[t.length - 1] : '';
    const up = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase();
    return (up(first) + (last ? up(last) : '')) || 'XX';
  }
  function newPriv() {
    const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return { salt, people: {}, keys: {} };
  }
  const fpIban = (priv, iban) => 'i' + hash(priv.salt + iban.toUpperCase()) + hash(priv.salt + iban.toUpperCase(), 3);
  const fpName = (priv, name) => 'n' + hash(priv.salt + nameKey(name));

  function kurzelFor(priv, name, kind) {
    const base = (kind === 'client' ? 'client_' : 'person_') + initials(name);
    let k = base, i = 2;
    while (priv.people[k]) k = base + i++;
    priv.people[k] = { name, kind };
    return k;
  }
  // Wer ist diese Buchung? Liefert das bekannte Kürzel oder null.
  function knownKurzel(priv, tx) {
    if (tx.iban && priv.keys[fpIban(priv, tx.iban)]) return priv.keys[fpIban(priv, tx.iban)];
    if (tx.party && priv.keys[fpName(priv, tx.party)]) return priv.keys[fpName(priv, tx.party)];
    return null;
  }
  function scrub(tx, k, kind) {
    const name = tx.party;
    tx.party = k; tx.iban = ''; tx.anon = kind;
    if (kind === 'client') {
      tx.ref = (String(tx.ref).match(/MGT[\w/.\-]*/gi) || []).join(' ');
      tx.text = '';
    } else {
      const toks = nameTokens(name).filter(t => t.length > 1).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const re = toks.length ? new RegExp('\\b(' + toks.join('|') + ')\\b', 'gi') : null;
      const clean = s => (re ? String(s).replace(re, '•') : String(s)).replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g, '•');
      tx.ref = clean(tx.ref); tx.text = clean(tx.text);
    }
    return tx;
  }
  // Anonymisiert eine Buchung an Ort und Stelle (vor dem Speichern). Gibt 'client' | 'person' | null zurück.
  function anonymise(tx, priv) {
    if (tx.anon) return tx.anon;
    let k = knownKurzel(priv, tx);
    const isClient = CLIENT_RE.test(tx.ref + ' ' + tx.text);
    if (!k && !isClient) return null;
    if (!k) {
      k = kurzelFor(priv, tx.party, 'client');
    }
    const kind = priv.people[k] ? priv.people[k].kind : 'client';
    if (tx.iban) priv.keys[fpIban(priv, tx.iban)] = k;
    if (tx.party) priv.keys[fpName(priv, tx.party)] = k;
    scrub(tx, k, kind);
    return kind;
  }
  // "Diese Person anonymisieren": legt das Kürzel an; die Buchungen werden danach mit anonymise() umgeschrieben.
  function hidePerson(priv, tx) {
    const known = knownKurzel(priv, tx);
    if (known) return known;
    const k = kurzelFor(priv, tx.party, 'person');
    if (tx.iban) priv.keys[fpIban(priv, tx.iban)] = k;
    if (tx.party) priv.keys[fpName(priv, tx.party)] = k;
    return k;
  }
  function renameKurzel(priv, from, to) {
    if (!priv.people[from] || priv.people[to] || !/^[\w-]{2,40}$/.test(to)) return false;
    priv.people[to] = priv.people[from]; delete priv.people[from];
    for (const [fp, k] of Object.entries(priv.keys)) if (k === from) priv.keys[fp] = to;
    return true;
  }

  // ---------- Kategorisieren ----------
  const reCache = new Map();
  const rx = s => { let r = reCache.get(s); if (!r) { r = new RegExp(s, 'i'); reCache.set(s, r); } return r; };
  const condCount = r => ['text', 'party', 'ref', 'iban', 'type', 'mcc', 'card', 'sign', 'src'].filter(k => r[k] != null && r[k] !== '').length;
  function matches(r, tx) {
    if (r.iban && r.iban.replace(/\s/g, '').toUpperCase() !== String(tx.iban || '').toUpperCase()) return false;
    if (r.src && r.src !== tx.src) return false;
    if (r.sign === '+' && !(tx.amt > 0)) return false;
    if (r.sign === '-' && !(tx.amt < 0)) return false;
    if (r.card != null && !!r.card !== !!tx.card) return false;
    if (r.mcc && !r.mcc.includes(tx.mcc)) return false;
    if (r.type && !rx(r.type).test(tx.type || '')) return false;
    if (r.party && !rx(r.party).test(tx.party || '')) return false;
    if (r.ref && !rx(r.ref).test(tx.ref || '')) return false;
    if (r.text && !rx(r.text).test([tx.party, tx.ref, tx.text].join(' | '))) return false;
    return true;
  }
  // Persönliche Regeln zuerst, die genauesten (meiste Bedingungen) vorne; danach die allgemeinen.
  function orderRules(personal) {
    return [...(personal || [])].filter(r => r && r.cat).sort((a, b) => condCount(b) - condCount(a) || String(a.id).localeCompare(String(b.id)));
  }
  // → { cat, how: 'manuell'|'regel'|'allgemein'|'mcc'|null, rule }
  function categorise(tx, ordered, cats) {
    const ok = c => c && (!cats || cats.byCat[c]);
    if (ok(tx.cat)) return { cat: tx.cat, how: 'manuell', rule: null };
    for (const r of ordered) if (ok(r.cat) && matches(r, tx)) return { cat: r.cat, how: 'regel', rule: r };
    for (const r of SEED_RULES) if (ok(r.cat) && matches(r, tx)) return { cat: r.cat, how: 'allgemein', rule: r };
    if (tx.card && tx.mcc && ok(MCC[tx.mcc])) return { cat: MCC[tx.mcc], how: 'mcc', rule: null };
    return { cat: null, how: null, rule: null };
  }
  function monthOf(tx, rule) {
    if (rule && rule.month === 'ref') {
      const m = String(tx.ref || '').match(/\b(\d{1,2})\s*\/\s*(\d{4})\b/);
      if (m && +m[1] >= 1 && +m[1] <= 12) return m[2] + '-' + String(m[1]).padStart(2, '0');
    }
    return tx.date.slice(0, 7);
  }
  // Alle Buchungen mit Kategorie, Art und Monat.
  function classify(txs, personalRules, cats) {
    const ordered = orderRules(personalRules);
    return txs.map(tx => {
      const c = categorise(tx, ordered, cats);
      const info = c.cat ? cats.byCat[c.cat] : null;
      return { tx, cat: c.cat, how: c.how, rule: c.rule, kind: info ? info.kind : null, group: info ? info.group : null, month: monthOf(tx, c.rule) };
    });
  }
  // Zahlen eines Monats. Ausgaben positiv gezählt; Rückzahlungen in einer Ausgaben-Kategorie verringern sie.
  function monthSummary(classified, month) {
    const s = { month, ein: 0, aus: 0, invest: 0, offen: 0, offenN: 0, topf: {}, groups: {}, cats: {}, n: 0 };
    for (const c of classified) {
      if (c.month !== month) continue;
      s.n++;
      const a = c.tx.amt;
      if (!c.cat) { s.offen += a; s.offenN++; continue; }
      if (c.kind === 'aus') { s.aus -= a; s.groups[c.group] = (s.groups[c.group] || 0) - a; s.cats[c.cat] = (s.cats[c.cat] || 0) - a; }
      else if (c.kind === 'ein') { s.ein += a; s.groups[c.group] = (s.groups[c.group] || 0) + a; s.cats[c.cat] = (s.cats[c.cat] || 0) + a; }
      else if (c.kind === 'topf') { s.topf[c.group] = (s.topf[c.group] || 0) + a; s.cats[c.cat] = (s.cats[c.cat] || 0) + a; }
      else if (c.kind === 'invest') s.invest -= a;
    }
    const r = x => round2(x);
    s.ein = r(s.ein); s.aus = r(s.aus); s.invest = r(s.invest); s.offen = r(s.offen);
    for (const o of [s.topf, s.groups, s.cats]) for (const k of Object.keys(o)) o[k] = r(o[k]);
    s.topfSum = r(Object.values(s.topf).reduce((x, y) => x + y, 0));
    s.uebrig = r(s.ein - s.aus + s.topfSum);
    return s;
  }
  function monthsOf(classified) {
    return [...new Set(classified.filter(c => c.kind !== 'versteckt').map(c => c.month))].sort();
  }

  const api = { DEFAULT_GROUPS, KIND_NAMES, SEED_RULES, MCC, CLIENT_RE, buildCats, hash, decodeBytes, parseCSV, detect, parseExport,
    normBank99, normTR, b99Merchant, nameKey, initials, newPriv, anonymise, hidePerson, renameKurzel, knownKurzel, scrub,
    matches, orderRules, categorise, classify, monthOf, monthSummary, monthsOf, round2 };
  root.FinCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
