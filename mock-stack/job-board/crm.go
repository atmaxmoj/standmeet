// crm.go —— a tiny CRM-ish SaaS mock surface for #155 §3 (agent-tool exposure). An owner uploads a
// binding-less OpenAPI connector pointing here with expose_as_agent_tools=true; its operations
// (contacts.list / contacts.search / deals.create) become per-session agent tools the visitor LLM
// can call. These endpoints just return fixed 200 JSON — the agent path consumes the raw SaaS shape
// (no contract / JSONata mapping), so any well-formed body proves the runtime executed the op.

package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

type crmContact struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type crmContactsResp struct {
	Contacts []crmContact `json:"contacts"`
}

type crmDealResp struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func (s *server) serveCRMContacts(w http.ResponseWriter, _ *http.Request) {
	writeCRMJSON(s.log, w, crmContactsResp{Contacts: []crmContact{
		{ID: "c1", Name: "Recruiter Rachel", Email: "rachel@example.com"},
	}})
}

func (s *server) serveCRMContactSearch(w http.ResponseWriter, _ *http.Request) {
	writeCRMJSON(s.log, w, crmContactsResp{Contacts: []crmContact{
		{ID: "c1", Name: "Recruiter Rachel", Email: "rachel@example.com"},
	}})
}

func (s *server) serveCRMDealCreate(w http.ResponseWriter, _ *http.Request) {
	writeCRMJSON(s.log, w, crmDealResp{ID: "deal-1", Status: "created"})
}

func writeCRMJSON(log *slog.Logger, w http.ResponseWriter, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Error("crm mock encode", "err", err)
	}
}
