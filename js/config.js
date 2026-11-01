// Site-wide settings for a published copy of FieldPack.
// Fill these in once (e.g. before publishing on GitHub Pages) so users don't
// have to do any setup themselves. Leave blank to let each user enter their own.
export const CONFIG = {
  // Application (client) ID of a Microsoft Entra app registration (SPA) used
  // for Excel Online. Register it with "Accounts in any organizational
  // directory and personal Microsoft accounts", and add every site address's
  // /auth-redirect.html as an SPA redirect URI.
  msClientId: '',

  // URL of your FieldPack spec-lookup relay (see worker/spec-proxy.js and the README).
  // When set, every visitor gets Gemini + Google Search spec checks in "Add gear with AI"
  // without needing their own key; your Gemini key stays secret on Cloudflare.
  specProxyUrl: 'https://fieldpack-specs.garrettsemola.workers.dev/',
};
