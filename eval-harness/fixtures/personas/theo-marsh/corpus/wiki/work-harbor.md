---
uri: wiki://work/harbor
title: Harbor — patient intake forms
kind: wiki
tags: [work, project]
---
Online intake forms for clinics (TypeScript + Postgres). Consent: the patient signs a consent
section on the intake form, and the server stores a consent record with the form. Every
analytics event carries a consent flag read from that record, and the event client drops any
event whose flag is missing — so analytics can never run ahead of consent.
