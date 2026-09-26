// i18n.ts —— the SDK widgets' UI copy, in the same 8 languages as the app (app/src/i18n/locales.ts).
// The widgets render on owners' pages for visitors in any language; their copy used to be hardcoded
// English (owner, 2026-09-25). Every widget string comes from here via t('key'); the lint rule in
// eslint.config.mjs rejects inline copy under src/widgets, and the Catalog type (Record over the
// English keys) makes a missing or extra key in any locale a compile error.
//
// The visitor's language: the page's stored choice (`sm-lang`, the key microsite pages use), else
// the browser's languages, else English. Resolved after mount — a prerendered page has no visitor
// yet, so the first render is English and the client switches once it knows (no hydration mismatch).

import { useEffect, useState } from 'react';

export const LOCALES = ['en', 'zh', 'fr', 'hi', 'de', 'ja', 'ko', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

const en = {
  askPlaceholder: 'Ask anything…',
  askLabel: 'Ask a question',
  ask: 'ask ↗',
  newConversation: 'New conversation',
  thinking: 'thinking',
  needKeyPlaceholder: 'Add your AI key above to ask',
  useSavedKey: 'Use your saved AI key instead →',
  useOwnKey: 'Use your own AI key instead →',
  onYourKey: 'on your {provider} key',
  forgetKey: 'forget it',
  errRateLimited: 'The AI is busy right now — give it a minute and ask again.',
  byokIntro: 'The free quota here is used up. Bring your own AI key to keep asking — it stays encrypted in this browser, goes out only with your questions, and reads only what’s public.',
  byokProvider: 'AI provider',
  byokEndpoint: 'Endpoint',
  byokModel: 'Model',
  byokModelPlaceholder: 'model id',
  byokKey: 'API key',
  byokSaveFailed: 'Couldn’t save the key in this browser.',
  byokSubmit: 'use my key ↗',
  blockNoSession: 'Open this page with an access code to use this.',
  blockRun: 'Run',
  blockUnreachable: 'The plugin could not be reached.',
  blockNeedCode: 'No visitor session — open this page with an access code.',
  blockRefused: 'The plugin refused this request.',
  corpusHeading: 'from the corpus',
  corpusReading: 'reading…',
  corpusOpen: 'open ↗',
  gateKicker: 'access',
  gateLabel: 'Have a code, or want in?',
  gateSublabel: 'enter a code · bring your own key · request access ↗',
  pageNavHeading: 'elsewhere on this site',
} as const;

export type MessageKey = keyof typeof en;
type Catalog = Record<MessageKey, string>;

const zh: Catalog = {
  askPlaceholder: '想问什么都可以…',
  askLabel: '提一个问题',
  ask: '提问 ↗',
  newConversation: '新对话',
  thinking: '思考中',
  needKeyPlaceholder: '先在上面填好你的 AI key 再提问',
  useSavedKey: '改用你保存的 AI key →',
  useOwnKey: '改用你自己的 AI key →',
  onYourKey: '正在用你的 {provider} key',
  forgetKey: '删除它',
  errRateLimited: 'AI 现在有点忙——稍等一分钟再问。',
  byokIntro: '这里的免费额度已经用完了。带上你自己的 AI key 就能继续提问——它加密保存在这个浏览器里，只随你的问题发出，也只能读取公开的内容。',
  byokProvider: 'AI 服务商',
  byokEndpoint: '接口地址',
  byokModel: '模型',
  byokModelPlaceholder: '模型 id',
  byokKey: 'API key',
  byokSaveFailed: '无法在这个浏览器里保存 key。',
  byokSubmit: '用我的 key ↗',
  blockNoSession: '请用邀请码打开这个页面来使用它。',
  blockRun: '运行',
  blockUnreachable: '插件暂时连不上。',
  blockNeedCode: '没有访客会话——请用邀请码打开这个页面。',
  blockRefused: '插件拒绝了这个请求。',
  corpusHeading: '来自语料库',
  corpusReading: '读取中…',
  corpusOpen: '打开 ↗',
  gateKicker: '访问',
  gateLabel: '有邀请码，或者想要一个？',
  gateSublabel: '输入邀请码 · 自带 key · 申请访问 ↗',
  pageNavHeading: '站内其他页面',
};

const fr: Catalog = {
  askPlaceholder: 'Posez n’importe quelle question…',
  askLabel: 'Poser une question',
  ask: 'demander ↗',
  newConversation: 'Nouvelle conversation',
  thinking: 'réflexion',
  needKeyPlaceholder: 'Ajoutez votre clé IA ci-dessus pour poser une question',
  useSavedKey: 'Utiliser plutôt votre clé IA enregistrée →',
  useOwnKey: 'Utiliser plutôt votre propre clé IA →',
  onYourKey: 'sur votre clé {provider}',
  forgetKey: 'l’oublier',
  errRateLimited: 'L’IA est occupée pour le moment — réessayez dans une minute.',
  byokIntro: 'Le quota gratuit ici est épuisé. Apportez votre propre clé IA pour continuer — elle reste chiffrée dans ce navigateur, n’est envoyée qu’avec vos questions et ne lit que ce qui est public.',
  byokProvider: 'Fournisseur IA',
  byokEndpoint: 'Point d’accès',
  byokModel: 'Modèle',
  byokModelPlaceholder: 'id du modèle',
  byokKey: 'Clé API',
  byokSaveFailed: 'Impossible d’enregistrer la clé dans ce navigateur.',
  byokSubmit: 'utiliser ma clé ↗',
  blockNoSession: 'Ouvrez cette page avec un code d’accès pour l’utiliser.',
  blockRun: 'Lancer',
  blockUnreachable: 'Le plugin est injoignable.',
  blockNeedCode: 'Aucune session visiteur — ouvrez cette page avec un code d’accès.',
  blockRefused: 'Le plugin a refusé cette demande.',
  corpusHeading: 'extrait du corpus',
  corpusReading: 'lecture…',
  corpusOpen: 'ouvrir ↗',
  gateKicker: 'accès',
  gateLabel: 'Vous avez un code, ou voulez entrer ?',
  gateSublabel: 'saisir un code · apporter sa clé · demander l’accès ↗',
  pageNavHeading: 'ailleurs sur ce site',
};

const hi: Catalog = {
  askPlaceholder: 'कुछ भी पूछिए…',
  askLabel: 'सवाल पूछें',
  ask: 'पूछें ↗',
  newConversation: 'नई बातचीत',
  thinking: 'सोच रहा है',
  needKeyPlaceholder: 'पूछने के लिए ऊपर अपनी AI key जोड़ें',
  useSavedKey: 'इसके बजाय अपनी सहेजी हुई AI key इस्तेमाल करें →',
  useOwnKey: 'इसके बजाय अपनी AI key इस्तेमाल करें →',
  onYourKey: 'आपकी {provider} key पर',
  forgetKey: 'इसे हटाएँ',
  errRateLimited: 'AI अभी व्यस्त है — एक मिनट बाद फिर पूछें।',
  byokIntro: 'यहाँ का मुफ़्त कोटा ख़त्म हो गया है। पूछते रहने के लिए अपनी AI key लाएँ — यह इसी ब्राउज़र में एन्क्रिप्ट होकर रहती है, सिर्फ़ आपके सवालों के साथ भेजी जाती है, और सिर्फ़ सार्वजनिक सामग्री पढ़ती है।',
  byokProvider: 'AI प्रदाता',
  byokEndpoint: 'एंडपॉइंट',
  byokModel: 'मॉडल',
  byokModelPlaceholder: 'मॉडल id',
  byokKey: 'API key',
  byokSaveFailed: 'इस ब्राउज़र में key सहेजी नहीं जा सकी।',
  byokSubmit: 'मेरी key इस्तेमाल करें ↗',
  blockNoSession: 'इसे इस्तेमाल करने के लिए यह पेज एक्सेस कोड के साथ खोलें।',
  blockRun: 'चलाएँ',
  blockUnreachable: 'प्लगइन तक पहुँचा नहीं जा सका।',
  blockNeedCode: 'कोई विज़िटर सत्र नहीं — यह पेज एक्सेस कोड के साथ खोलें।',
  blockRefused: 'प्लगइन ने यह अनुरोध अस्वीकार कर दिया।',
  corpusHeading: 'कॉर्पस से',
  corpusReading: 'पढ़ रहा है…',
  corpusOpen: 'खोलें ↗',
  gateKicker: 'पहुँच',
  gateLabel: 'कोड है, या अंदर आना चाहते हैं?',
  gateSublabel: 'कोड डालें · अपनी key लाएँ · पहुँच का अनुरोध करें ↗',
  pageNavHeading: 'इस साइट पर और',
};

const de: Catalog = {
  askPlaceholder: 'Frag, was du willst…',
  askLabel: 'Eine Frage stellen',
  ask: 'fragen ↗',
  newConversation: 'Neues Gespräch',
  thinking: 'denkt nach',
  needKeyPlaceholder: 'Oben deinen KI-Schlüssel eintragen, um zu fragen',
  useSavedKey: 'Stattdessen deinen gespeicherten KI-Schlüssel nutzen →',
  useOwnKey: 'Stattdessen deinen eigenen KI-Schlüssel nutzen →',
  onYourKey: 'über deinen {provider}-Schlüssel',
  forgetKey: 'vergessen',
  errRateLimited: 'Die KI ist gerade ausgelastet — frag in einer Minute noch einmal.',
  byokIntro: 'Das kostenlose Kontingent hier ist aufgebraucht. Bring deinen eigenen KI-Schlüssel mit, um weiterzufragen — er bleibt verschlüsselt in diesem Browser, wird nur mit deinen Fragen gesendet und liest nur Öffentliches.',
  byokProvider: 'KI-Anbieter',
  byokEndpoint: 'Endpunkt',
  byokModel: 'Modell',
  byokModelPlaceholder: 'Modell-ID',
  byokKey: 'API-Schlüssel',
  byokSaveFailed: 'Der Schlüssel konnte in diesem Browser nicht gespeichert werden.',
  byokSubmit: 'meinen Schlüssel nutzen ↗',
  blockNoSession: 'Öffne diese Seite mit einem Zugangscode, um das zu nutzen.',
  blockRun: 'Ausführen',
  blockUnreachable: 'Das Plugin ist nicht erreichbar.',
  blockNeedCode: 'Keine Besuchersitzung — öffne diese Seite mit einem Zugangscode.',
  blockRefused: 'Das Plugin hat diese Anfrage abgelehnt.',
  corpusHeading: 'aus dem Korpus',
  corpusReading: 'lädt…',
  corpusOpen: 'öffnen ↗',
  gateKicker: 'Zugang',
  gateLabel: 'Einen Code, oder willst du rein?',
  gateSublabel: 'Code eingeben · eigenen Schlüssel mitbringen · Zugang anfragen ↗',
  pageNavHeading: 'woanders auf dieser Seite',
};

const ja: Catalog = {
  askPlaceholder: 'なんでも聞いてください…',
  askLabel: '質問する',
  ask: '質問 ↗',
  newConversation: '新しい会話',
  thinking: '考え中',
  needKeyPlaceholder: '質問するには上で AI キーを入力してください',
  useSavedKey: '保存した AI キーを使う →',
  useOwnKey: '自分の AI キーを使う →',
  onYourKey: 'あなたの {provider} キーを使用中',
  forgetKey: '削除する',
  errRateLimited: 'AI が混み合っています。1 分ほどしてからもう一度どうぞ。',
  byokIntro: 'ここの無料枠を使い切りました。自分の AI キーを使えば引き続き質問できます。キーはこのブラウザ内で暗号化して保存され、あなたの質問と一緒にだけ送られ、公開された内容だけを読みます。',
  byokProvider: 'AI プロバイダー',
  byokEndpoint: 'エンドポイント',
  byokModel: 'モデル',
  byokModelPlaceholder: 'モデル ID',
  byokKey: 'API キー',
  byokSaveFailed: 'このブラウザにキーを保存できませんでした。',
  byokSubmit: '自分のキーを使う ↗',
  blockNoSession: '使うにはアクセスコード付きでこのページを開いてください。',
  blockRun: '実行',
  blockUnreachable: 'プラグインに接続できませんでした。',
  blockNeedCode: '訪問者セッションがありません。アクセスコード付きでこのページを開いてください。',
  blockRefused: 'プラグインがこのリクエストを拒否しました。',
  corpusHeading: 'コーパスから',
  corpusReading: '読み込み中…',
  corpusOpen: '開く ↗',
  gateKicker: 'アクセス',
  gateLabel: 'コードをお持ちですか、それとも入りたいですか？',
  gateSublabel: 'コードを入力 · 自分のキーを使う · アクセスを申請 ↗',
  pageNavHeading: 'このサイトのほかのページ',
};

const ko: Catalog = {
  askPlaceholder: '무엇이든 물어보세요…',
  askLabel: '질문하기',
  ask: '질문 ↗',
  newConversation: '새 대화',
  thinking: '생각 중',
  needKeyPlaceholder: '질문하려면 위에 AI 키를 입력하세요',
  useSavedKey: '저장한 AI 키 사용하기 →',
  useOwnKey: '내 AI 키 사용하기 →',
  onYourKey: '내 {provider} 키 사용 중',
  forgetKey: '삭제',
  errRateLimited: 'AI가 지금 바빠요. 1분 뒤에 다시 물어보세요.',
  byokIntro: '여기의 무료 사용량을 다 썼어요. 내 AI 키를 가져오면 계속 질문할 수 있어요. 키는 이 브라우저에 암호화되어 저장되고, 내 질문과 함께만 전송되며, 공개된 내용만 읽어요.',
  byokProvider: 'AI 제공업체',
  byokEndpoint: '엔드포인트',
  byokModel: '모델',
  byokModelPlaceholder: '모델 id',
  byokKey: 'API 키',
  byokSaveFailed: '이 브라우저에 키를 저장하지 못했어요.',
  byokSubmit: '내 키 사용 ↗',
  blockNoSession: '사용하려면 액세스 코드로 이 페이지를 여세요.',
  blockRun: '실행',
  blockUnreachable: '플러그인에 연결할 수 없어요.',
  blockNeedCode: '방문자 세션이 없어요. 액세스 코드로 이 페이지를 여세요.',
  blockRefused: '플러그인이 이 요청을 거부했어요.',
  corpusHeading: '코퍼스에서',
  corpusReading: '읽는 중…',
  corpusOpen: '열기 ↗',
  gateKicker: '접근',
  gateLabel: '코드가 있거나, 들어오고 싶으세요?',
  gateSublabel: '코드 입력 · 내 키 사용 · 접근 요청 ↗',
  pageNavHeading: '이 사이트의 다른 곳',
};

const es: Catalog = {
  askPlaceholder: 'Pregunta lo que quieras…',
  askLabel: 'Hacer una pregunta',
  ask: 'preguntar ↗',
  newConversation: 'Nueva conversación',
  thinking: 'pensando',
  needKeyPlaceholder: 'Añade tu clave de IA arriba para preguntar',
  useSavedKey: 'Usar tu clave de IA guardada →',
  useOwnKey: 'Usar tu propia clave de IA →',
  onYourKey: 'con tu clave de {provider}',
  forgetKey: 'olvidarla',
  errRateLimited: 'La IA está ocupada ahora mismo — vuelve a preguntar en un minuto.',
  byokIntro: 'La cuota gratuita de aquí se ha agotado. Trae tu propia clave de IA para seguir preguntando — se guarda cifrada en este navegador, solo se envía con tus preguntas y solo lee lo que es público.',
  byokProvider: 'Proveedor de IA',
  byokEndpoint: 'Endpoint',
  byokModel: 'Modelo',
  byokModelPlaceholder: 'id del modelo',
  byokKey: 'Clave API',
  byokSaveFailed: 'No se pudo guardar la clave en este navegador.',
  byokSubmit: 'usar mi clave ↗',
  blockNoSession: 'Abre esta página con un código de acceso para usar esto.',
  blockRun: 'Ejecutar',
  blockUnreachable: 'No se pudo contactar con el plugin.',
  blockNeedCode: 'No hay sesión de visitante — abre esta página con un código de acceso.',
  blockRefused: 'El plugin rechazó esta solicitud.',
  corpusHeading: 'del corpus',
  corpusReading: 'leyendo…',
  corpusOpen: 'abrir ↗',
  gateKicker: 'acceso',
  gateLabel: '¿Tienes un código o quieres entrar?',
  gateSublabel: 'introducir un código · traer tu clave · solicitar acceso ↗',
  pageNavHeading: 'en otras partes de este sitio',
};

export const CATALOGS: Record<Locale, Catalog> = { en, zh, fr, hi, de, ja, ko, es };

function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v);
}

// resolveLocale —— explicit wins; else the page's stored `sm-lang`; else the browser's languages
// (first whose base matches); else English. Never throws (private mode / no window).
export function resolveLocale(explicit?: string): Locale {
  if (explicit !== undefined && isLocale(explicit)) return explicit;
  try {
    const stored = localStorage.getItem('sm-lang') ?? '';
    if (isLocale(stored)) return stored;
  } catch { /* no storage */ }
  try {
    for (const tag of navigator.languages ?? [navigator.language]) {
      const base = tag.toLowerCase().split('-')[0] ?? '';
      if (isLocale(base)) return base;
    }
  } catch { /* no navigator (SSR) */ }
  return 'en';
}

export type T = (key: MessageKey, vars?: Record<string, string>) => string;

export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string>): string {
  let s = CATALOGS[locale][key];
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, v);
  return s;
}

// useT —— t() in the visitor's language. English on the first (prerender-matching) render; the
// visitor's language right after mount.
export function useT(): T {
  const [locale, setLocale] = useState<Locale>('en');
  useEffect(() => { setLocale(resolveLocale()); }, []);
  return (key, vars) => translate(locale, key, vars);
}
