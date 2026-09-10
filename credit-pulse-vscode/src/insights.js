"use strict";

const windows = data => data?.windows || [];
const windowById = (data,id) => windows(data).find(window=>window.id===id);
const finite = value => Number.isFinite(value);

function usagePercent(data) {
  const primary=windowById(data,"primary");
  return primary?.used ?? (windows(data).length ? Math.max(...windows(data).map(window=>window.used)) : null);
}

function pressurePercent(data) {
  return windows(data).length ? Math.max(...windows(data).map(window=>window.used)) : null;
}

function tokenLabel(value) {
  if (!finite(value)) return "unknown";
  if (value>=1_000_000) return `${(value/1_000_000).toFixed(1)}M`;
  if (value>=1_000) return `${Math.round(value/1_000)}k`;
  return String(value);
}

function resetLabel(stamp, now) {
  if (!finite(stamp)) return "at an unknown time";
  const minutes=Math.max(0,Math.ceil((stamp-now)/60));
  if (minutes<60) return `in ${minutes}m`;
  if (minutes<1440) return `in ${Math.floor(minutes/60)}h ${minutes%60}m`;
  return `in ${Math.floor(minutes/1440)}d ${Math.floor(minutes%1440/60)}h`;
}

function developerMetrics(data,chats) {
  const primary=windowById(data,"primary"),secondary=windowById(data,"secondary"),latest=chats?.[0];
  const requests=(latest?.requests || []).filter(request=>finite(request.usage?.total_tokens));
  const average=requests.length ? requests.reduce((sum,request)=>sum+request.usage.total_tokens,0)/requests.length : null;
  const latestRequest=requests.at(-1)?.usage?.total_tokens ?? null;
  const cacheRatio=latest?.usage?.input_tokens>0 ? latest.usage.cached_input_tokens/latest.usage.input_tokens : null;
  let score=cacheRatio===null ? 50 : 45+cacheRatio*50;
  score-=Math.max(0,(latest?.requestCount || 0)-7)*3;
  if (finite(average)&&finite(latestRequest)&&latestRequest>average*1.5) score-=8;
  return {
    sessionRemaining:finite(primary?.used)?Math.max(0,100-primary.used):null,
    longRemaining:finite(secondary?.used)?Math.max(0,100-secondary.used):null,
    cacheRatio:cacheRatio===null?null:Math.round(cacheRatio*100),
    averageRequestTokens:average===null?null:Math.round(average),
    latestRequestTokens:latestRequest,
    requestCount:latest?.requestCount || 0,
    efficiencyScore:Math.round(Math.max(0,Math.min(100,score)))
  };
}

function recommendations(data, chats, threshold = 80, now = Date.now()/1000) {
  const primary=windowById(data,"primary"),secondary=windowById(data,"secondary"),latest=chats?.[0];
  const metrics=developerMetrics(data,chats),result=[];
  if (primary) {
    const used=Math.round(primary.used),remaining=Math.max(0,100-used),reset=resetLabel(primary.resetsAt,now);
    if (primary.estimated) result.push(`The 5-hour window reset and Codex temporarily omitted it. Credit Pulse is showing an inferred 0% until the next live report; refresh after your next request.`);
    else if (used>=95) result.push(`The 5-hour window is ${used}% used with ${remaining}% left and resets ${reset}. Finish the current change and defer broad exploration until reset.`);
    else if (used>=threshold) result.push(`The 5-hour window is ${used}% used with ${remaining}% headroom and resets ${reset}. Combine the next edit, test, and review into one request.`);
    else result.push(`The 5-hour window is ${used}% used with ${remaining}% headroom and resets ${reset}. This is enough room to keep implementation and validation in the same request.`);
  } else if (secondary) {
    result.push(`Codex did not report the 5-hour window. The long window is ${Math.round(secondary.used)}% used; refresh after the next Codex request to reacquire the session bucket.`);
  } else result.push("No live quota window is available. Check Codex sign-in before relying on reset or capacity guidance.");

  if (secondary && secondary.used>=threshold) {
    result.push(`The long window is ${Math.round(secondary.used)}% used with ${Math.max(0,100-Math.round(secondary.used))}% left and resets ${resetLabel(secondary.resetsAt,now)}. Avoid parallel exploratory chats until it recovers.`);
  }

  if (latest) {
    const title=`“${latest.title.slice(0,48)}${latest.title.length>48?"…":""}”`;
    if (finite(metrics.cacheRatio)) {
      if (metrics.cacheRatio>=60) result.push(`${title} is reusing ${metrics.cacheRatio}% of input context across ${latest.requestCount} requests. Continue here for this feature; open a new chat only when the code area changes.`);
      else if (latest.requestCount>=4) result.push(`${title} reuses only ${metrics.cacheRatio}% of input across ${latest.requestCount} requests. Start a clean chat for the next unrelated task instead of carrying this context.`);
    }
    if (finite(metrics.latestRequestTokens)&&finite(metrics.averageRequestTokens)&&metrics.latestRequestTokens>metrics.averageRequestTokens*1.45) {
      const request=latest.requests.at(-1)?.preview || "Latest request";
      result.push(`“${request.slice(0,44)}${request.length>44?"…":""}” processed ${tokenLabel(metrics.latestRequestTokens)} tokens versus a ${tokenLabel(metrics.averageRequestTokens)} request average. Trim repeated logs and name exact files next time.`);
    } else if (latest.requestCount>=8) {
      result.push(`${title} is ${latest.requestCount} requests deep. Keep it for follow-up fixes, but start a clean chat before switching subsystem to reduce carried context.`);
    }
  }
  return result.slice(0,4);
}

function mascotState(data, threshold = 80) {
  const max=pressurePercent(data);
  if (max===null||data?.source!=="live") return {face:"🤖",label:"SIGNAL LOST",mode:"quiet"};
  if (max>=100) return {face:"🤯",label:"LIMIT CRITICAL",mode:"limit"};
  if (max>=threshold) return {face:"😬",label:"QUOTA RUNNING HOT",mode:"warning"};
  if (max>=55) return {face:"😎",label:"FLOW LOCKED",mode:"steady"};
  return {face:"🤖",label:"SYSTEM NOMINAL",mode:"cheer"};
}

module.exports = {usagePercent,pressurePercent,developerMetrics,recommendations,mascotState};
