# Scheda per il Chrome Web Store

Testi pronti da incollare nella dashboard dello sviluppatore. La prima pubblicazione è una prova:
**visibilità "Non in elenco"**, così la installa solo chi ha il link. Se la revisione va bene, si può
passare a "Pubblica" più tardi.

## Pacchetto

```sh
sh scripts/package.sh     # crea dist/sondaggi-in-bozza-<versione>.zip
```

## Scheda dello Store

- **Nome:** Sondaggi in bozza (preso dal manifest)
- **Riepilogo** (dal manifest): Prepara e modifica sondaggi in bozza, anche presi da una chat, e mandali
  su WhatsApp Web. Non affiliata a WhatsApp né a Meta.
- **Categoria:** Produttività > Strumenti
- **Lingua:** Italiano
- **Icona:** `icons/128.png`
- **Screenshot (1280×800):** `store/screenshot-1-bozza.png`, `store/screenshot-2-conferma.png`,
  `store/screenshot-3-registro.png`, `store/screenshot-4-da-una-chat.png` (si rigenerano con
  `node store/screenshots.mjs`)
- **Sito web:** https://github.com/MatteoGranziera/sondaggi-in-bozza
- **Assistenza:** https://github.com/MatteoGranziera/sondaggi-in-bozza/issues

### Descrizione

> Sondaggi in bozza tiene in ordine i sondaggi che mandi con WhatsApp Web: li prepari con calma, li
> correggi quando vuoi e li mandi quando sono pronti.
>
> • Scrivi domanda e opzioni, con le emoji e la ricerca in italiano, e guarda l'anteprima.
> • Oppure parti da un sondaggio che c'è già: apri la chat e trasformalo in una bozza.
> • Il sondaggio resta in bozza finché non decidi di mandarlo, e resta modificabile anche dopo.
> • Lo mandi a una persona o a un gruppo alla volta: per esempio a un amico per un parere, poi al
>   gruppo. Prima di ogni invio rivedi testo e destinatario, e confermi.
> • Il registro dice a chi è arrivato, quando e con quale versione del testo.
>
> Non è uno strumento per gli invii di massa: un destinatario per volta, sempre con conferma.
>
> Privacy: niente server, niente statistiche. Sondaggi, contatti e registro restano nel tuo browser; i
> sondaggi escono solo attraverso WhatsApp Web, verso i destinatari che confermi.
>
> Funziona nel pannello laterale di Chrome, accanto a una scheda di WhatsApp Web collegata al tuo
> telefono. Sondaggi in bozza è un progetto indipendente e open source: non è di WhatsApp né di Meta e
> non è affiliato a loro. WhatsApp è un marchio di WhatsApp LLC.

### Description (English)

> Sondaggi in bozza ("poll drafts") keeps your WhatsApp polls as drafts: write the question and options
> (with an emoji picker) or start from a poll already in an open chat, check the preview, edit it any
> time, and send it to one person or one group at a time, for example to a friend for feedback and then
> to the group. Every send shows the text and the recipient and needs a confirmation; a log shows who got
> which version and when.
>
> Not a bulk messaging tool: one recipient per send, always confirmed. No server, no analytics: polls,
> contacts and the log stay in your browser. Independent open-source project, not affiliated with
> WhatsApp or Meta. The interface is in Italian.

## Privacy (scheda "Privacy" della dashboard)

**Scopo unico:** gestire sondaggi in bozza per WhatsApp Web: crearli o prenderli da una chat aperta,
modificarli e mandarli, dopo una conferma, a un destinatario alla volta scelto dall'utente.

**Giustificazione dei permessi**

- `sidePanel`: l'interfaccia è un pannello laterale accanto alla scheda di WhatsApp Web.
- `storage`: salva in locale i sondaggi, i destinatari scelti e il registro degli invii.
- Accesso a `https://web.whatsapp.com/*`: lo script di contenuto legge l'elenco di gruppi e contatti e,
  quando l'utente lo chiede, i sondaggi della chat aperta; manda i sondaggi confermati dall'utente, nella
  sua sessione di WhatsApp Web. Non tocca altri siti.

**Codice remoto:** no. Tutto il codice è nel pacchetto, comprese le librerie in `vendor/`.

**Dati gestiti** (tutti solo sul dispositivo, mai trasmessi a server dello sviluppatore o di terzi):

- Informazioni che consentono l'identificazione personale: nomi e numeri dei contatti scelti come
  destinatari, nome di chi ha mandato un sondaggio preso da una chat.
- Comunicazioni personali: il testo dei sondaggi, compresi quelli presi da una chat.

**Dichiarazioni:** i dati non vengono venduti né trasferiti a terzi, non vengono usati per scopi
diversi dallo scopo unico e non vengono usati per valutare l'affidabilità creditizia.

**URL della privacy policy:** https://github.com/MatteoGranziera/sondaggi-in-bozza/blob/main/PRIVACY.md

## Note per chi fa la revisione (in inglese)

> The extension only runs on web.whatsapp.com and in its own side panel. It needs a WhatsApp account
> linked to WhatsApp Web to send anything. To try it: open web.whatsapp.com and link a phone, open the
> side panel from the toolbar icon, accept the first-run notice, create a poll (or open a chat that has a
> poll and press "Da una chat"), pick a group or type a number in the Contacts search, press Send and
> confirm.
>
> vendor/wa-js/wppconnect-wa.js is the unmodified, minified release build of the open-source WA-JS
> library (https://github.com/wppconnect-team/wa-js, Apache-2.0, version in vendor/wa-js/VERSION). It
> exposes WhatsApp Web's own functions; content/config.js disables its analytics before it loads, and
> polls are sent with link previews off, so no request goes to any third-party server.
> vendor/emoji-picker is the unmodified emoji-picker-element release with its Italian data (Apache-2.0).
>
> Every send goes to exactly one recipient and requires the user to confirm the poll text and that
> recipient; after a send the recipient must be chosen again. There is no batch or scheduled sending.
