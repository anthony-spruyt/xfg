import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError,
  GraphQLApiError,
  SyncError,
  LifecycleError,
} from "../../../src/shared/errors.js";

describe("custom error classes", () => {
  test("ValidationError has correct name and message", () => {
    const err = new ValidationError("bad config");
    assert.equal(err.name, "ValidationError");
    assert.equal(err.message, "bad config");
    assert.ok(err instanceof Error);
  });

  test("GraphQLApiError has correct name and message", () => {
    const err = new GraphQLApiError("query failed");
    assert.equal(err.name, "GraphQLApiError");
    assert.equal(err.message, "query failed");
    assert.ok(err instanceof Error);
  });

  test("SyncError has correct name and message", () => {
    const err = new SyncError("sync failed");
    assert.equal(err.name, "SyncError");
    assert.equal(err.message, "sync failed");
    assert.ok(err instanceof Error);
  });

  test("LifecycleError has correct name and message", () => {
    const err = new LifecycleError("lifecycle failed");
    assert.equal(err.name, "LifecycleError");
    assert.equal(err.message, "lifecycle failed");
    assert.ok(err instanceof Error);
  });

  test("error types are distinguishable via instanceof", () => {
    const errors = [
      new ValidationError("a"),
      new GraphQLApiError("b"),
      new SyncError("c"),
      new LifecycleError("d"),
    ];
    assert.ok(errors[0] instanceof ValidationError);
    assert.ok(!(errors[0] instanceof SyncError));
    assert.ok(errors[2] instanceof SyncError);
    assert.ok(!(errors[2] instanceof ValidationError));
  });
});
