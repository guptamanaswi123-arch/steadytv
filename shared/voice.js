/* SteadyVoice: turns what the phone microphone heard into a TV remote command.
 * Works for English and Hindi words at the same time, so the person never has to pick a language
 * for the microphone separately. Returns one of:
 *   'enter' | 'back' | 'up' | 'down' | 'left' | 'right' | 'repeat' | 'mute' | 'unmute' | null */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SteadyVoice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Checked in this order: more specific commands first ("go back" must not become "go").
  const RULES = [
    ['unmute', ['unmute', 'sound on', 'speak', 'आवाज़ चालू', 'आवाज चालू']],
    ['mute', ['mute', 'silent', 'quiet', 'sound off', 'आवाज़ बंद', 'आवाज बंद', 'चुप']],
    ['repeat', ['repeat', 'again', 'say that again', 'what', 'दोहराओ', 'दोहराइए', 'दोबारा', 'फिर से', 'फिरसे']],
    ['back', ['back', 'stop', 'cancel', 'exit', 'quit', 'no', 'स्टॉप', 'स्टोप', 'पीछे', 'वापस', 'रुको', 'रुकिए', 'रुकें', 'बंद', 'नहीं', 'नही']],
    ['up', ['up', 'ऊपर']],
    ['down', ['down', 'नीचे']],
    ['left', ['left', 'बाएं', 'बाएँ', 'बायां', 'बाया']],
    ['right', ['right', 'दाएं', 'दाएँ', 'दायां', 'दाया']],
    ['enter', ['start', 'begin', 'next', 'continue', 'yes', 'yeah', 'okay', 'ok', 'go', 'select', 'ready', 'done', 'resume', 'proceed',
      'स्टार्ट', 'नेक्स्ट', 'शुरू', 'शुरु', 'आगे', 'अगला', 'हाँ', 'हां', 'ठीक', 'चलो', 'चलिए', 'जारी', 'तैयार', 'ओके']],
  ];

  function tokens(text) {
    return String(text || '').toLowerCase().replace(/[.,!?;:"'“”‘’()\-]/g, ' ').split(/\s+/).filter(Boolean);
  }

  function parse(text) {
    const words = tokens(text);
    if (!words.length) return null;
    const joined = ' ' + words.join(' ') + ' ';
    for (const [cmd, list] of RULES) {
      for (const phrase of list) {
        // multi-word phrases match as a phrase; single words must be a whole word
        if (joined.includes(' ' + phrase + ' ')) return cmd;
      }
    }
    return null;
  }

  return { parse, tokens, RULES };
});
