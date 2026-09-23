/**
 * Cloudflare Pages Function – fängt POST-Anfragen vom Kontaktformular ab
 * und sendet die Formulardaten per E-Mail über Resend an roland.bender@gmail.com.
 * GET-Anfragen werden an die statische Startseite durchgereicht.
 */

// Honeypot-Feld und interne Felder nicht in die E-Mail übernehmen
const SKIP_KEYS = ['bot-field', 'form-name', 'subject', 'privacy-consent'];

function prettyLabel(key) {
  return key.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

async function fileToBase64(file) {
  var buffer = await file.arrayBuffer();
  var bytes = new Uint8Array(buffer);
  var binary = '';
  for (var i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function onRequestPost(context) {
  var request = context.request;
  var env = context.env;

  var formData;
  try {
    formData = await request.formData();
  } catch (e) {
    return new Response('Bad request', { status: 400 });
  }

  // Honeypot: ausgefüllt = Bot → still succeed, nichts senden
  if (formData.get('bot-field')) {
    return new Response('OK', { status: 200 });
  }

  var formName = formData.get('form-name') || 'inquiry';
  var subject = formData.get('subject') || 'Neue Anfrage über iHelpLang (' + formName + ')';
  var submitterEmail = formData.get('email') || '';

  // Lesbare E-Mail aus Formulardaten aufbauen
  var lines = ['Neue Anfrage über iHelpLang', ''];
  var attachments = [];

  for (var entry of formData.entries()) {
    var key = entry[0];
    var value = entry[1];

    if (SKIP_KEYS.indexOf(key) !== -1) continue;

    if (value instanceof File) {
      if (value.size > 0) {
        lines.push(prettyLabel(key) + ': ' + value.name + ' (' + (value.size / 1024).toFixed(1) + ' KB)');
        if (value.size <= 5 * 1024 * 1024) {
          try {
            attachments.push({
              filename: value.name,
              content: await fileToBase64(value)
            });
          } catch (e) {
            lines.push('  (Datei konnte nicht angehängt werden)');
          }
        }
      }
      continue;
    }

    if (value) {
      lines.push(prettyLabel(key) + ': ' + value);
    }
  }

  lines.push('', '---', 'Gesendet über das Kontaktformular auf eng-deu.pages.dev');

  var emailText = lines.join('\n');

  // Resend API Key muss als Umgebungsvariable gesetzt sein
  var apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY nicht gesetzt');
    return new Response('Server error', { status: 500 });
  }

  var payload = {
    from: 'iHelpLang <onboarding@resend.dev>',
    to: 'roland.bender@gmail.com',
    subject: subject,
    text: emailText
  };

  if (submitterEmail) {
    payload.reply_to = submitterEmail;
  }

  if (attachments.length > 0) {
    payload.attachments = attachments;
  }

  try {
    var res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error('Resend Fehler:', await res.text());
      return new Response('Submission failed', { status: 500 });
    }
  } catch (e) {
    console.error('Fetch Fehler:', e);
    return new Response('Submission failed', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

// GET-Anfragen an statische Assets durchreichen (Startseite laden)
export async function onRequestGet(context) {
  return context.env.ASSETS.fetch(context.request);
