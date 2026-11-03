# Scheda per il Chrome Web Store

Testi pronti da incollare nella dashboard dello sviluppatore. La prima pubblicazione è una prova:
**visibilità "Non in elenco"**, così la installa solo chi ha il link. Se la revisione va bene, si può
passare a "Pubblica" più tardi.

## Prima di cominciare

- **Account:** quello Google personale. L'iscrizione come sviluppatore costa 5 dollari una volta sola.
- **Trader o non trader:** lo Store chiede a ogni sviluppatore di dichiararlo (regole europee DSA). Per
  un progetto gratuito e personale, senza attività commerciale, è "non trader". Un trader deve
  verificare nome, indirizzo e telefono, e il telefono compare sulla scheda.
- **Due copie insieme no:** prima di installare la versione dello Store, esporta i sondaggi da quella
  caricata da cartella, disattivala in `chrome://extensions` e importali nella nuova. Due copie attive
  caricherebbero WA-JS due volte nella stessa pagina di WhatsApp Web.

## Pacchetto

```sh
sh scripts/package.sh     # crea dist/sondaggi-in-bozza-<versione>.zip
```

Lo stesso zip è allegato a ogni release su GitHub.

## Scheda dello Store

- **Nome:** Sondaggi in bozza (preso dal manifest)
- **Riepilogo** (dal manifest): Sondaggi in bozza da preparare, modificare e mandare nella chat aperta
  di WhatsApp Web. Non affiliata a WhatsApp né a Meta.
- **Categoria:** Produttività > Strumenti
- **Lingua:** Italiano
- **Icona dello Store (128×128, disegno 96×96 con margine trasparente):** `store/icon-store-128.png`
- **Tessera promozionale piccola (440×280, obbligatoria):** `store/promo-small-440x280.png`
- **Screenshot (1280×800):** `store/screenshot-1-bozza.png`, `store/screenshot-2-conferma.png`,
  `store/screenshot-3-registro.png`, `store/screenshot-4-da-una-chat.png`. Screenshot e tessera si
  rigenerano con `node store/screenshots.mjs`.
- **Video YouTube:** la guida della dashboard lo elenca fra i materiali promozionali. Se la dashboard
  non lascia proseguire senza, basta un video breve caricato come "non in elenco".
- **Sito web:** https://github.com/MatteoGranziera/sondaggi-in-bozza
- **Assistenza:** https://github.com/MatteoGranziera/sondaggi-in-bozza/issues

### Descrizione

> Sondaggi in bozza tiene in ordine i sondaggi che mandi con WhatsApp Web: li prepari con calma, li
> correggi quando vuoi e li mandi quando sono pronti.
>
> • Scrivi domanda e opzioni, con le emoji e la ricerca in italiano, e guarda l'anteprima.
> • Oppure parti da un sondaggio che c'è già: apri la chat e trasformalo in una bozza.
> • Il sondaggio resta in bozza finché non decidi di mandarlo, e resta modificabile anche dopo.
> • Lo mandi nella chat aperta in WhatsApp Web: sotto l'anteprima c'è un solo tasto con il nome di
>   quella chat. Per esempio: apri la chat con un amico per un parere, poi apri il gruppo e mandalo lì.
> • Il registro dice in quali chat è arrivato, quando e con quale versione del testo.
>
> Non è uno strumento per gli invii di massa: niente elenchi di destinatari, una chat alla volta, quella
> che hai aperto.
>
> Privacy: niente server, niente statistiche, nessun accesso alla rubrica. Sondaggi e registro restano
> nel tuo browser; i sondaggi escono solo attraverso WhatsApp Web, nella chat che hai aperto.
>
> Funziona nel pannello laterale di Chrome, accanto a una scheda di WhatsApp Web collegata al tuo
> telefono. Sondaggi in bozza è un progetto indipendente e open source: non è di WhatsApp né di Meta e
> non è affiliato a loro. WhatsApp è un marchio di WhatsApp LLC.

### Description (English)

> Sondaggi in bozza ("poll drafts") keeps your WhatsApp polls as drafts: write the question and options
> (with an emoji picker) or start from a poll already in an open chat, check the preview and edit it any
> time. To send, open a chat in WhatsApp Web: the single button under the preview shows that chat's name
> and sends the poll there, for example to a friend for feedback, then to the group. A log shows which
> chats got which version and when.
>
> Not a bulk messaging tool: no recipient lists, one chat at a time, the one you have open. No server, no
> analytics, no access to your address book: polls and the log stay in your browser. Independent
> open-source project, not affiliated with WhatsApp or Meta. The interface is in Italian.

## Privacy (scheda "Privacy" della dashboard)

**Scopo unico:** gestire sondaggi in bozza per WhatsApp Web: crearli o prenderli da una chat aperta,
modificarli e mandarli nella chat aperta in WhatsApp Web, con un clic su un tasto che ne mostra il nome.

**Giustificazione dei permessi**

- `sidePanel`: l'interfaccia è un pannello laterale accanto alla scheda di WhatsApp Web.
- `storage`: salva in locale i sondaggi e il registro degli invii.
- Accesso a `https://web.whatsapp.com/*`: lo script di contenuto legge quale chat è aperta e, quando
  l'utente lo chiede, i sondaggi di quella chat; manda il sondaggio nella chat aperta quando l'utente
  preme il tasto di invio, nella sua sessione di WhatsApp Web. Non tocca altri siti.

**Codice remoto:** no. Tutto il codice è nel pacchetto, comprese le librerie in `vendor/`.

**Dati gestiti** (tutti solo sul dispositivo, mai trasmessi a server dello sviluppatore o di terzi):

- Informazioni che consentono l'identificazione personale: nome della chat aperta (persona o gruppo),
  nome di chi ha mandato un sondaggio preso da una chat.
- Comunicazioni personali: il testo dei sondaggi, compresi quelli presi da una chat.

**Dichiarazioni:** i dati non vengono venduti né trasferiti a terzi, non vengono usati per scopi
diversi dallo scopo unico e non vengono usati per valutare l'affidabilità creditizia.

**URL della privacy policy:** https://github.com/MatteoGranziera/sondaggi-in-bozza/blob/main/PRIVACY.md

## Note per chi fa la revisione (in inglese)

> The extension only runs on web.whatsapp.com and in its own side panel. It needs a WhatsApp account
> linked to WhatsApp Web to send anything. To try it: open web.whatsapp.com and link a phone, open the
> side panel from the toolbar icon, accept the first-run notice, create a poll (or open a chat that has a
> poll and press "Da una chat"), open the chat to send it to, and press the "Invia a <chat name>" button
> under the preview.
>
> vendor/wa-js/wppconnect-wa.js is the unmodified, minified release build of the open-source WA-JS
> library (https://github.com/wppconnect-team/wa-js, Apache-2.0, version in vendor/wa-js/VERSION). It
> exposes WhatsApp Web's own functions; content/config.js disables its analytics before it loads, and
> polls are sent with link previews off, so no request goes to any third-party server.
> vendor/emoji-picker is the unmodified emoji-picker-element release with its Italian data (Apache-2.0).
>
> A poll is only ever sent to the chat currently open in WhatsApp Web, after the user presses a button
> labelled with that chat's name, placed under a preview of the poll. Just before sending, the page
> checks that the open chat is still that one; if it changed, nothing is sent. There are no recipient
> lists, no batch or scheduled sending, and no access to contacts.
