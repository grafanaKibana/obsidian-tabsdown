/** Let Node-only CLI contract tests import the SDK without installing or launching a browser. */
export const chromium={launch:async()=>({close:async()=>{}})};
