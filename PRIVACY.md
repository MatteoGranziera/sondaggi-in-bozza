# Privacy: Sondaggi in bozza

Ultimo aggiornamento: 3 novembre 2026. [English below.](#english)

Sondaggi in bozza è un'estensione di Chrome indipendente, non affiliata a WhatsApp né a Meta. Non ha un
server e non raccoglie dati: tutto quello che usa resta nel tuo browser.

## Cosa usa e dove resta

- **I sondaggi che scrivi**, con il registro degli invii (in quale chat, quando, com'è andata): salvati
  in `chrome.storage.local`, cioè nel profilo di Chrome sul tuo computer.
- **Il nome e l'identificativo della chat aperta in WhatsApp Web**, per mostrarli sul tasto di invio.
  Finiscono nel registro solo quando ci mandi un sondaggio.
- **I sondaggi della chat aperta**, solo quando premi "Da una chat": domanda, opzioni, data e nome di
  chi l'ha mandato, per mostrarteli. Diventa una bozza solo quello che scegli.

L'estensione non legge la rubrica, l'elenco delle chat o i tuoi messaggi: a parte i sondaggi della chat
aperta quando lo chiedi tu, conosce solo quale chat hai aperto.

## Cosa esce dal tuo computer

Solo i sondaggi che mandi, nella chat aperta, quando premi il tasto che ne mostra il nome, attraverso
WhatsApp Web, come se li mandassi a mano. L'estensione non invia dati a nessun altro server: niente
statistiche, niente pubblicità, niente servizi di terzi. La libreria WA-JS inclusa avrebbe di base un
tracciamento con Google Analytics e un servizio esterno per le anteprime dei link: l'estensione li tiene
spenti tutti e due.

## Cosa non fa

Non vende, non cede e non condivide dati con nessuno. Non li usa per pubblicità, profilazione o per
valutare l'affidabilità creditizia.

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

**What it uses and where it stays.** The polls you write and their send log (which chat, when, outcome)
are stored in `chrome.storage.local`, in your Chrome profile on your device. The name and ID of the chat
open in WhatsApp Web are read to label the send button; they are saved in the log only when you send a
poll there. When you press "Da una chat" ("from a chat"), the polls in the open chat (question, options,
date, sender name) are read to list them; only the one you pick becomes a draft. The extension does not
read your address book, your chat list or your messages; apart from the polls of the open chat when you
ask, it only knows which chat is open.

**What leaves your device.** Only the polls you send, to the open chat, when you press the button that
shows its name, through WhatsApp Web, exactly as if you sent them by hand. No data goes to any other
server: no analytics, no ads, no third-party services. The bundled WA-JS library would by default use
Google Analytics and an external link-preview service; the extension keeps both turned off.

**What it does not do.** It does not sell, transfer or share data with anyone, and does not use it for
advertising, profiling or creditworthiness.

**Deleting your data.** Delete polls from the panel, or uninstall the extension: Chrome removes
everything it stored.

**Contact.** Open an issue on [GitHub](https://github.com/MatteoGranziera/sondaggi-in-bozza/issues).
