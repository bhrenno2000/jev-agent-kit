import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateQuality,
  classifyNoul,
  confusionMatrix,
  overallRecallCountingAbstentionsAsMisses,
} from "../../scripts/evaluate.js";

describe("evaluation metrics", () => {
  it("uses tri-state Noul thresholds with an abstention band", () => {
    assert.equal(classifyNoul(0.2), false);
    assert.equal(classifyNoul(0.8), true);
    assert.equal(classifyNoul(0.5), null);
    assert.equal(classifyNoul(-0.1), null);
    assert.equal(classifyNoul(1.1), null);
  });

  it("computes confusion counts and excludes abstentions from precision and recall denominators", () => {
    const result = confusionMatrix([
      { expected: true, actual: true },
      { expected: true, actual: false },
      { expected: false, actual: true },
      { expected: false, actual: false },
      { expected: true, actual: null },
    ]);
    assert.deepEqual(result, {
      truePositive: 1,
      trueNegative: 1,
      falsePositive: 1,
      falseNegative: 1,
      abstained: 1,
      total: 5,
      precision: 0.5,
      recall: 0.5,
    });
  });

  it("counts an abstained positive as a missed positive in overall recall", () => {
    assert.equal(
      overallRecallCountingAbstentionsAsMisses([
        { expected: true, actual: true },
        { expected: true, actual: null },
        { expected: false, actual: null },
      ]),
      0.5,
    );
  });

  it("keeps failed cases in quality denominators and excludes ungraded scores", () => {
    const fixture = {
      version: 1,
      cases: [
        { id: "success", state: "x", questions: { x: { type: "noul" } }, expected: { x: true } },
        { id: "failed", state: "x", questions: { x: { type: "noul" } }, expected: { x: true } },
        {
          id: "uncertain",
          state: "x",
          questions: { x: { type: "choice" } },
          expected: { x: null },
        },
        { id: "score", state: "x", questions: { x: { type: "score" } }, expected: { x: null } },
      ],
    };
    const result = aggregateQuality(fixture, [
      { id: "success", exitCode: 0, answers: { x: { expected: true, actual: true } } },
      { id: "failed", exitCode: 1 },
      { id: "uncertain", exitCode: 0, answers: { x: { expected: null, actual: null } } },
      { id: "score", exitCode: 0, answers: { x: { expected: null, actual: null } } },
    ]);
    assert.equal(result.expectedAnswers, 3);
    assert.equal(result.errors, 1);
    assert.equal(result.exactMatchRate, 2 / 3);
    assert.equal(result.availability, 2 / 3);
    assert.equal(result.coverage, 1 / 3);
    assert.equal(result.selectiveNoul.recall, 1);
    assert.equal(result.overallNoulRecallCountingAbstentionsAsMisses, 0.5);
  });
});
