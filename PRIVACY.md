# Privacy: Sondaggi in bozza

Ultimo aggiornamento: 3 novembre 2026. [English below.](#english)

Sondaggi in bozza è un'estensione di Chrome indipendente, non affiliata a WhatsApp né a Meta. Non ha un
server e non raccoglie dati: tutto quello che usa resta nel tuo browser.

## Cosa usa e dove resta

- **I sondaggi che scrivi**, con il registro degli invii (a chi, quando, com'è andata): salvati in
  `chrome.storage.local`, cioè nel profilo di Chrome sul tuo computer.
- **I nomi e gli identificativi dei tuoi gruppi, e i nomi e i numeri dei tuoi contatti**: letti dalla
  scheda di WhatsApp Web aperta nel browser, solo quando li chiedi, per mostrarteli nell'elenco. Restano
  in memoria finché il pannello è aperto. Viene salvato solo quello che scegli come destinatario,
  insieme al sondaggio e al registro degli invii.
- **I sondaggi della chat aperta**, solo quando premi "Da una chat": domanda, opzioni, data e nome di
  chi l'ha mandato, per mostrarteli. Diventa una bozza solo quello che scegli. Gli altri messaggi della
  chat non vengono letti.

## Cosa esce dal tuo computer

Solo i sondaggi che mandi, ai destinatari che confermi, attraverso WhatsApp Web, come se li mandassi a
mano. L'estensione non invia dati a nessun altro server: niente statistiche, niente pubblicità, niente
servizi di terzi. La libreria WA-JS inclusa avrebbe di base un tracciamento con Google Analytics e un
servizio esterno per le anteprime dei link: l'estensione li tiene spenti tutti e due.

## Cosa non fa

Non vende, non cede e non condivide dati con nessuno. Non li usa per pubblicità, profilazione o per
valutare l'affidabilità creditizia. Non legge i tuoi messaggi, a parte i sondaggi della chat aperta
quando lo chiedi tu.

## Come cancellare i dati

Elimina i sondaggi dal pannello, oppure disinstalla l'estensione: Chrome cancella tutto quello che ha
salvato.

## Contatti

Per domande apri una issue su [GitHub](https://github.com/MatteoGranziera/sondaggi-in-bozza/issues).

---

## English

Last updated: November 3, 2026.

Sondaggi in bozza ("poll drafts") is an independent Chrome extension, not affiliated with WhatsApp or
Meta. It has no server and collects no data: everything it uses stays in your browser.

**What it uses and where it stays.** The polls you write and their send log are stored in
`chrome.storage.local`, in your Chrome profile on your device. The names and IDs of your groups, and the
names and numbers of your contacts, are read from the WhatsApp Web tab open in your browser, only when
you ask, to list them for you. They stay in memory while the panel is open; only the one you pick as
recipient is saved, together with the poll and its send log. When you press "Da una chat" ("from a
chat"), the polls in the open chat (question, options, date, sender name) are read to list them; only
the one you pick becomes a draft, and no other message is read.

**What leaves your device.** Only the polls you send, to the recipients you confirm, through WhatsApp Web,
exactly as if you sent them by hand. The extension sends no data to any other server: no analytics, no
ads, no third-party services. The bundled WA-JS library would by default use Google Analytics and an
external link-preview service; the extension keeps both turned off.

**What it does not do.** It does not sell, transfer or share data with anyone, and does not use it for
advertising, profiling or creditworthiness. It does not read your messages, except the polls in the open
chat when you ask for them.

**Deleting your data.** Delete polls from the panel, or uninstall the extension: Chrome removes
everything it stored.

**Contact.** Open an issue on [GitHub](https://github.com/MatteoGranziera/sondaggi-in-bozza/issues).
