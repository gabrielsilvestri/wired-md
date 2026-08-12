# wired-md, demonstração

Editor de markdown com renderização inline, feito para quem escreve para IA.

## O que este arquivo exercita

- Lista simples com **negrito** e *itálico*
- Código inline: `npm start`
- [Um link](https://example.com)

### Código

```js
function soma(a, b) {
  // comentário em português: soma até dois números
  return a + b;
}
```

### Tabela

| Recurso | Estado | Observação |
| --- | --- | --- |
| Render inline | pronto | modo IR do Vditor |
| Temas | pronto | wired e claro |
| Terminal | pronto | node-pty com fallback |

### Citação

> A rede é vasta e infinita.
> Ninguém escreve markdown sozinho.

### Tarefas

- [x] Fase 1: editor
- [x] Fase 2: temas e terminal
- [ ] Fase 3: teste de verdade
