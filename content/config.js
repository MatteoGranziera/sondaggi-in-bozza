// WA-JS reads window.WPPConfig once, when it loads, so this file runs right before it.
// Its analytics are on by default: turned off, nothing about the user leaves WhatsApp Web.
window.WPPConfig = {
  ...(window.WPPConfig || {}),
  disableGoogleAnalytics: true,
  googleAnalyticsId: null,
  poweredBy: null,
};
