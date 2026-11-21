/**
 * Tests del corpus multilingüe (ES / EN / PT) para la ruta editorial.
 * Verifica reconocimiento de intenciones, segmentación de oraciones y
 * verificación de afirmaciones en los tres idiomas sin llamadas a red.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { editorialIntent } from '../../src/orchestration/editorial-intent.js';
import { classifyClaims, claimStateOf, splitSentences } from '../../src/agents/claim-evidence.js';
import type { CompleteFn } from '../../src/agents/editorial-provider.js';

describe('Corpus multilingüe — Reconocimiento de intenciones (ES / EN / PT)', () => {
  it('reconoce síntesis en los tres idiomas', () => {
    assert.equal(editorialIntent('Sintetiza las fuentes en un párrafo'), 'synthesis');
    assert.equal(editorialIntent('Synthesize sources into an executive report'), 'synthesis');
    assert.equal(editorialIntent('Sintetize os relatorios das equipes'), 'synthesis');
    assert.equal(editorialIntent('Combine findings from all documents'), 'synthesis');
    assert.equal(editorialIntent('Unifique as informacoes das fontes'), 'synthesis');
  });

  it('reconoce resumen en los tres idiomas', () => {
    assert.equal(editorialIntent('Resume el documento adjunto'), 'summary');
    assert.equal(editorialIntent('Summarize the operational review'), 'summary');
    assert.equal(editorialIntent('Resuma o relatório financeiro'), 'summary');
    assert.equal(editorialIntent('Make a summary of this report'), 'summary');
    assert.equal(editorialIntent('Faca um resumo executivo'), 'summary');
  });

  it('reconoce reescritura / humanización en los tres idiomas', () => {
    assert.equal(editorialIntent('Humaniza los párrafos técnicos'), 'rewrite');
    assert.equal(editorialIntent('Rewrite the section in clear technical tone'), 'rewrite');
    assert.equal(editorialIntent('Reescreva os paragrafos da documentacao'), 'rewrite');
  });

  it('reconoce traducción en los tres idiomas', () => {
    assert.equal(editorialIntent('Traduce este texto al inglés'), 'translation');
    assert.equal(editorialIntent('Translate this document to Spanish'), 'translation');
    assert.equal(editorialIntent('Traduza este comunicado para o português'), 'translation');
  });

  it('reconoce extracción en los tres idiomas', () => {
    assert.equal(editorialIntent('Extrae las citas principales'), 'extract');
    assert.equal(editorialIntent('Extract excerpts from the document'), 'extract');
    assert.equal(editorialIntent('Extraia os trechos mais relevantes'), 'extract');
  });

  it('reconoce conversión en los tres idiomas', () => {
    assert.equal(editorialIntent('Convierte el reporte a markdown'), 'conversion');
    assert.equal(editorialIntent('Convert the word document to pdf'), 'conversion');
    assert.equal(editorialIntent('Converta este documento para markdown'), 'conversion');
  });

  it('reconoce redacción en los tres idiomas', () => {
    assert.equal(editorialIntent('Redacta un correo para el equipo'), 'draft');
    assert.equal(editorialIntent('Draft an email to stakeholders'), 'draft');
    assert.equal(editorialIntent('Redija uma mensagem institucional'), 'draft');
    assert.equal(editorialIntent('Escreva um documento tecnico'), 'draft');
  });
});

describe('Corpus multilingüe — Segmentación de oraciones (splitSentences)', () => {
  it('segmenta texto en inglés preservando abreviaciones, números y URLs', () => {
    const text =
      'The API latency is approx. 12.5 ms on v2.1 of the gateway. ' +
      'Check bitbucket.org/directvla/repo for details. ' +
      'Dr. Watson verified the metrics.';
    const sentences = splitSentences(text);
    assert.equal(sentences.length, 3);
    assert.match(sentences[0], /approx\. 12\.5 ms on v2\.1/);
    assert.match(sentences[1], /repo for details\.$/);
    assert.match(sentences[2], /^Dr\. Watson verified/);
  });

  it('segmenta texto en portugués preservando abreviaciones y mayúsculas acentuadas', () => {
    const text =
      'A taxa de adesão foi de aprox. 1.500 usuários na versão v3.0. ' +
      'A Eng. Mariana acompanhou a homologação técnica da empresa. ' +
      'Última validação concluída com sucesso.';
    const sentences = splitSentences(text);
    assert.equal(sentences.length, 3);
    assert.match(sentences[0], /aprox\. 1\.500/);
    assert.match(sentences[1], /Eng\. Mariana.*da empresa\./);
    assert.match(sentences[2], /^Última validação/);
  });
});

describe('Corpus multilingüe — Verificación de evidencia por afirmación', () => {
  const sourcesEN = [
    {
      id: 'F1',
      name: 'api-spec.md',
      text: 'The checkout API requires bearer tokens and returns 401 on expiration.',
    },
    {
      id: 'F2',
      name: 'sla-guide.md',
      text: 'Target latency for the payment engine is under 200 ms.',
    },
  ];

  const mockCompleteEN: CompleteFn = async (_m, _e, _t, _prompt, input) => {
    const parsed = JSON.parse(input) as { sentences: Array<{ index: number; sentence: string }> };
    return JSON.stringify({
      verdicts: parsed.sentences.map((s) => {
        if (s.sentence.includes('bearer tokens')) {
          return { index: s.index, claimClass: 'ACREDITADA', sourceId: 'F1', finding: '' };
        }
        if (s.sentence.includes('under 200 ms')) {
          return { index: s.index, claimClass: 'ACREDITADA', sourceId: 'F2', finding: '' };
        }
        return {
          index: s.index,
          claimClass: 'SIN_ACREDITAR',
          sourceId: '',
          finding: 'Unbacked in sources',
        };
      }),
    });
  };

  it('clasifica afirmaciones en fuentes en inglés', async () => {
    const sentences = [
      'The checkout API requires bearer tokens for authentication.',
      'Target latency for the payment engine is under 200 ms.',
    ];
    const report = await classifyClaims(sentences, sourcesEN, { model: 'mock' }, mockCompleteEN);
    assert.equal(report.summary.total, 2);
    assert.equal(report.summary.accredited, 2);
    assert.equal(report.blocking, false);
    assert.equal(claimStateOf(report), 'claim-review-clean');
  });

  const sourcesPT = [
    {
      id: 'F1',
      name: 'arquitetura.md',
      text: 'O microsserviço de pagamentos persiste as transações no DynamoDB.',
    },
  ];

  const mockCompletePT: CompleteFn = async (_m, _e, _t, _prompt, input) => {
    const parsed = JSON.parse(input) as { sentences: Array<{ index: number; sentence: string }> };
    return JSON.stringify({
      verdicts: parsed.sentences.map((s) => {
        if (s.sentence.includes('DynamoDB')) {
          return { index: s.index, claimClass: 'ACREDITADA', sourceId: 'F1', finding: '' };
        }
        return {
          index: s.index,
          claimClass: 'SIN_ACREDITAR',
          sourceId: '',
          finding: 'Sem respaldo',
        };
      }),
    });
  };

  it('detecta afirmaciones sin respaldar en portugués y bloquea la entrega', async () => {
    const sentences = [
      'O microsserviço de pagamentos persiste as transações no DynamoDB.',
      'O sistema suporta processamento quântico instantâneo.',
    ];
    const report = await classifyClaims(sentences, sourcesPT, { model: 'mock' }, mockCompletePT);
    assert.equal(report.summary.total, 2);
    assert.equal(report.summary.accredited, 1);
    assert.equal(report.summary.unaccredited, 1);
    assert.equal(report.blocking, true);
    assert.equal(claimStateOf(report), 'claim-evidence-failed');
  });
});
