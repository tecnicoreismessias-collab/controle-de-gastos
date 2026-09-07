MEU CONTROLE FINANCEIRO — VERSÃO DE PRODUÇÃO

Esta pasta contém a versão preparada para hospedagem estática.

Estrutura:
- index.html — Início
- login.html — autenticação
- analises.html — análises
- configuracao.html — configuração
- meses/ — 12 páginas mensais
- auth.js — conexão com Supabase

Banco:
Supabase project: rggcptzeptbnrcmjkcwc

Requisitos de hospedagem:
- hospedagem de arquivos estáticos (HTML/CSS/JS)
- HTTPS recomendado/necessário em produção
- não exige servidor Node/PHP

Observação:
O publishable key do Supabase pode ficar no frontend. A segurança dos dados é feita por autenticação + RLS no banco. Nunca colocar service_role key no frontend.
