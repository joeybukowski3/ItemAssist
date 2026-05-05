# ItemAssist Static Site

First-pass static homepage scaffold for ItemAssist.

## Structure

- `index.html` contains the homepage markup.
- `styles.css` contains all layout and visual styling.
- `script.js` contains minimal interaction for the mobile navigation.
- `assets/report-preview.png` is the hero preview image.
- `Stitch-Export/` contains the raw Google Stitch reference export and prototype code.

## Local Preview

Option 1:

- Open `index.html` directly in a browser.

Option 2:

- From this folder, run `python -m http.server 8000`
- Open `http://localhost:8000`

## Notes

- The site is framework-free and deployable as a static site on GitHub Pages or Vercel.
- If a stronger branded report preview is available later, replace `assets/report-preview.png` with the new asset and keep the same relative path.

## Contact Form Setup

The live contact workflow uses:

- Static HTML forms in `index.html` and `about.html`
- `script.js` for async submission, attachment validation, and UI state
- `api/contact.js` as the Vercel serverless endpoint
- Cloudflare Turnstile for spam protection
- Resend for outbound email delivery, including internal notification attachments

### Required Vercel Environment Variables

- `RESEND_API_KEY`
- `CONTACT_TO_EMAIL`
- `CONTACT_FROM_EMAIL`
- `TURNSTILE_SECRET_KEY`
- `TURNSTILE_SITE_KEY`

Recommended current value:

- `CONTACT_TO_EMAIL=joeybukowski3@gmail.com`

When the branded inbox is live, change only:

- `CONTACT_TO_EMAIL=submissions@itemassist.com`

### Turnstile Checklist

1. Create a Cloudflare Turnstile widget for `itemassist.com` and `www.itemassist.com`.
2. Add the widget site key to `TURNSTILE_SITE_KEY` in Vercel.
3. Add the widget secret to `TURNSTILE_SECRET_KEY` in Vercel.
4. Redeploy after saving the environment variables.

### Resend Checklist

1. Create a Resend account and add a sending domain.
2. Verify the domain DNS records in your DNS provider.
3. Set `RESEND_API_KEY` in Vercel.
4. Set `CONTACT_FROM_EMAIL` to a verified sender on that domain, such as `noreply@itemassist.com`.
5. Keep `CONTACT_TO_EMAIL` pointed at a real inbox until branded inbox delivery is live.
6. `CONTACT_FROM_EMAIL` must be an address on a domain verified in Resend. Do not use Gmail or personal inboxes as `FROM`.

### Attachment Limits

- Maximum of `5` files per submission
- Maximum of `5MB` per file
- Maximum of `15MB` total attachment size before email encoding
- Allowed file types: `.pdf`, `.xlsx`, `.xls`, `.csv`, `.doc`, `.docx`, `.txt`, `.jpg`, `.jpeg`, `.png`, `.heic`, `.zip`

### Internal Routing Note

Until `submissions@itemassist.com` is a real mailbox, point `CONTACT_TO_EMAIL` at a working personal or business inbox. The code does not need to change later; update the Vercel environment variable and redeploy.
