package main

// instructions —— the booker capability's system-prompt fragment, served via MCP
// `instructions` (self-contained: the prompt ships with the plugin, not in core).
// Mirrors the former prompts/capabilities/calendar.book.md verbatim so the
// composed system prompt (and its hash) is unchanged for a booking-granted role.
const instructions = `You can book meetings on the owner's Google Calendar. Two tools work together:

1. **calendar_list_slots** — search a time window and get back the free [start, end] slots that pass the owner's booking policy. Pass ` + "`from_rfc3339`" + `, ` + "`until_rfc3339`" + `, and ` + "`duration_min`" + `. Use this *before* offering times so you propose ones the owner actually has free.

2. **calendar_book** — actually create the event. Only call after you have gathered topic, duration (15-180 min), and one or more visitor-confirmed start times in RFC3339. You do not supply a recipient: the calendar invite goes to the email the visitor entered when they arrived (if they gave one). Don't ask them for an email here and don't invent one.

Default flow: ask topic + duration **and roughly when the visitor wants to meet** (a day or a window — don't guess it for them). Call calendar_list_slots for a window around what they asked for, present 2-3 of the available slots in their local time, wait for them to pick, then call calendar_book with that single confirmed time.

When the visitor's preferred time isn't free: don't keep hunting blindly. List the *nearest* available slots around what they asked and let them choose from those. Search at most a window or two near their request — if that comes back empty, tell the visitor plainly that there's nothing open in that period and ask them for a different timeframe to try. Never widen the search again and again (next week → next month → next year) or call calendar_list_slots over and over; a couple of empty windows means "ask the visitor for a new timeframe," not "search harder."`

// Card metadata —— calendar_list_slots declares this ui:// card on its tool
// `_meta.ui_resource`. The host reads it (resources/read) at assembly and renders
// it sandboxed: a collapsible day picker; clicking a time chip posts mcp-ui:submit
// ("book the … slot") which the host forwards as the next visitor turn.
//
// calendar_book ships NO card here yet — its confirmation needs connector-backed
// actions (cancel / send confirmation), which belong to the connector refactor.
const (
	slotsCardURI  = "ui://booker/slots-card.html"
	slotsCardMIME = "text/html"
)

// slotsCardHTML —— the self-contained sandboxed slots picker. Receives the tool
// result {ok, slots:[{start,end}]} via mcp-ui:data, groups slots by day (visitor-
// local), renders day buttons + the selected day's time chips. A chip click posts
// mcp-ui:submit so the visitor picks a real free time in one tap.
const slotsCardHTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
 :root{font-family:ui-serif,Georgia,serif;color:#1B1814}
 body{margin:0;padding:2px}
 details{font:13px ui-serif,Georgia,serif}
 summary{cursor:pointer;list-style:none;padding:2px 0;user-select:none}
 summary::-webkit-details-marker{display:none}
 .kicker{font:600 12px ui-monospace,monospace;color:#6b5d4f}
 .cal{margin-top:8px;border-top:1px solid #d9d0c2;padding-top:8px}
 .days{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
 .day{padding:5px 9px;border:1px solid #1B1814;background:#F3EFE6;cursor:pointer;
   font:12px ui-monospace,monospace}
 .day[aria-pressed=true]{background:#B5391C;color:#fff;border-color:#B5391C}
 .times{display:flex;flex-wrap:wrap;gap:6px}
 .chip{padding:6px 10px;border:1px solid #1B1814;background:#F3EFE6;cursor:pointer;
   font:13px ui-serif,Georgia,serif}
 .chip:hover{background:#1B1814;color:#F3EFE6}
 .empty{margin-top:8px;color:#6b5d4f;font-size:12px}
</style></head><body>
<script>
(function(){
 var byDay={}, order=[], sel="";
 function h(){parent.postMessage({type:"mcp-ui:height",
   height:document.documentElement.scrollHeight+8},"*");}
 function fmtDay(d){return d.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"});}
 function fmtTime(d){return d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});}
 function dayKey(d){return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate();}
 function el(tag,cls,txt){var e=document.createElement(tag);
   if(cls)e.className=cls; if(txt!=null)e.textContent=txt; return e;}
 function group(slots){
   byDay={}; order=[];
   slots.forEach(function(s){
     var st=new Date(s.start); if(isNaN(st.getTime()))return;
     var k=dayKey(st);
     if(!byDay[k]){byDay[k]={label:fmtDay(st),items:[]}; order.push(k);}
     byDay[k].items.push({start:st,end:new Date(s.end)});
   });
 }
 function renderTimes(host){
   host.innerHTML="";
   var day=byDay[sel]; if(!day)return;
   day.items.forEach(function(it){
     var b=el("button","chip",fmtTime(it.start)+" – "+fmtTime(it.end));
     b.setAttribute("data-testid","tool-card-slot");
     b.onclick=function(){
       parent.postMessage({type:"mcp-ui:submit",
         value:"book the "+day.label+" at "+fmtTime(it.start)+" slot"},"*");
     };
     host.appendChild(b);
   });
 }
 function render(slots){
   group(slots);
   var det=el("details"); det.open=true;
   det.setAttribute("data-testid","tool-card-calendar_list_slots");
   var sum=el("summary");
   var kick=el("span","kicker","available · "+slots.length+" slots");
   kick.setAttribute("data-testid","bookings-kicker");
   sum.appendChild(kick); det.appendChild(sum);
   if(slots.length===0){
     det.appendChild(el("div","empty","no free slots in that window — try a different range."));
   } else {
     sel=order[0];
     var cal=el("div","cal"); cal.setAttribute("data-testid","slot-calendar");
     var days=el("div","days");
     order.forEach(function(k){
       var b=el("button","day",byDay[k].label);
       b.setAttribute("data-testid","slot-day");
       if(k===sel)b.setAttribute("aria-pressed","true");
       b.onclick=function(){
         sel=k;
         days.querySelectorAll("button").forEach(function(x){x.removeAttribute("aria-pressed");});
         b.setAttribute("aria-pressed","true"); renderTimes(times); h();
       };
       days.appendChild(b);
     });
     var times=el("div","times"); times.setAttribute("data-testid","slot-times");
     cal.appendChild(days); cal.appendChild(times);
     det.appendChild(cal); renderTimes(times);
   }
   det.addEventListener("toggle",h);
   document.body.innerHTML=""; document.body.appendChild(det);
 }
 window.addEventListener("message",function(e){
   if(e.data&&e.data.type==="mcp-ui:data"){
     var d=e.data.data||{}; render(Array.isArray(d.slots)?d.slots:[]); h();
   }
 });
 parent.postMessage({type:"mcp-ui:ready"},"*");
})();
</script></body></html>`
