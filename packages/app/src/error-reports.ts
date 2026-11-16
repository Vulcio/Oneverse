/**
 * A web app's errors, reported (issue #469): sent to the API's
 * /error-reports, which reports them with Admin > Error reporting's DSN when
 * browsers' errors are on and drops them otherwise. The page sends its
 * error's kind, message, stack and path only; the API takes ids and tokens
 * out of it. Ten a page at most, each once.
 */

export type ReportingApp = "web" | "planiverse" | "oneverse" | "screen";

declare global {
  interface Window {
    __oneverseReportError?: (error: unknown) => void;
  }
}

/**
 * The script that listens for errors nothing caught, from the start - before
 * the app's bundle, so an error loading it is heard too. Written out as text,
 * not from a function's source (it would differ between server and client).
 */
export function errorReportScript(app: ReportingApp): string {
  return (
    "(function(){var sent={},count=0;" +
    "function send(error,fallback){try{" +
    "var type=(error&&error.name)||'Error',message=(error&&error.message)||fallback||String(error);" +
    // Not ours to fix: a browser's own noise, a script from elsewhere.
    "if(!message||/ResizeObserver loop|^Script error\\.?$/.test(message))return;" +
    "var key=type+':'+message;if(sent[key]||count>=10)return;sent[key]=1;count++;" +
    "var env=window.__PUBLIC_ENV__;if(!env||!env.apiUrl)return;" +
    "var body=JSON.stringify({app:" + JSON.stringify(app) + ",type:String(type).slice(0,200),message:String(message).slice(0,2000)," +
    "stack:error&&error.stack?String(error.stack).slice(0,20000):undefined,path:location.pathname.slice(0,500)});" +
    "fetch(env.apiUrl.replace(/\\/$/,'')+'/error-reports',{method:'POST',headers:{'Content-Type':'application/json'},body:body,credentials:'omit',keepalive:true}).catch(function(){});" +
    "}catch(_){}}" +
    // A file that didn't load is an event with no error and no message: left out.
    "window.addEventListener('error',function(event){if(event.error||event.message)send(event.error,event.message)});" +
    "window.addEventListener('unhandledrejection',function(event){send(event.reason,'Unhandled rejection')});" +
    "window.__oneverseReportError=function(error){send(error)};" +
    "})();"
  );
}

/** An error the app caught but couldn't recover from (a page that failed to render), reported the same way. */
export function reportPageError(error: unknown): void {
  if (typeof window !== "undefined") window.__oneverseReportError?.(error);
}
