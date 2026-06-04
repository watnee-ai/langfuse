import { afterEach, describe, it, expect, vi } from "vitest";
import {
  checkHeaderBasedDirectWrite,
  checkSdkVersionRequirements,
  groupIngestionEventsByBodyId,
  getSdkInfoFromResourceSpans,
  processOtelTraceEvents,
  type SdkInfo,
} from "../otelIngestionQueue";
import { env } from "../../env";
import type { IngestionEventType } from "@langfuse/shared/src/server";

const makeTraceEvent = ({
  id,
  timestamp,
  name,
  input,
  output,
}: {
  id: string;
  timestamp: string;
  name?: string;
  input?: unknown;
  output?: unknown;
}): IngestionEventType =>
  ({
    id: `event-${id}-${timestamp}`,
    type: "trace-create",
    timestamp,
    body: {
      id,
      timestamp,
      name,
      input,
      output,
    },
  }) as IngestionEventType;

const auth = {
  validKey: true,
  scope: {
    projectId: "project-1",
    accessLevel: "project",
  },
} as const;

afterEach(() => {
  env.LANGFUSE_OTEL_TRACE_DIRECT_WRITE = "false";
  vi.restoreAllMocks();
});

describe("checkHeaderBasedDirectWrite", () => {
  it.each<{
    input: Parameters<typeof checkHeaderBasedDirectWrite>[0];
    expected: boolean;
    label: string;
  }>([
    // Python SDK version checks
    {
      input: { sdkName: "python", sdkVersion: "4.0.0" },
      expected: true,
      label: "python 4.0.0 (exact minimum)",
    },
    {
      input: { sdkName: "python", sdkVersion: "4.2.1" },
      expected: true,
      label: "python 4.2.1 (above minimum)",
    },
    {
      input: { sdkName: "python", sdkVersion: "3.9.0" },
      expected: false,
      label: "python 3.9.0 (below minimum)",
    },

    // JS SDK version checks
    {
      input: { sdkName: "javascript", sdkVersion: "5.0.0" },
      expected: true,
      label: "javascript 5.0.0 (exact minimum)",
    },
    {
      input: { sdkName: "javascript", sdkVersion: "5.1.3" },
      expected: true,
      label: "javascript 5.1.3 (above minimum)",
    },
    {
      input: { sdkName: "javascript", sdkVersion: "4.6.0" },
      expected: false,
      label: "javascript 4.6.0 (below minimum)",
    },

    // Pre-release versions (stripped before comparison)
    {
      input: { sdkName: "python", sdkVersion: "4.0.0-rc.1" },
      expected: true,
      label: "python 4.0.0-rc.1 (pre-release at minimum)",
    },
    {
      input: { sdkName: "javascript", sdkVersion: "5.0.0-beta.1" },
      expected: true,
      label: "javascript 5.0.0-beta.1 (pre-release at minimum)",
    },
    {
      input: { sdkName: "python", sdkVersion: "4.1.0-rc.1" },
      expected: true,
      label: "python 4.1.0-rc.1 (pre-release above minimum)",
    },
    {
      input: { sdkName: "python", sdkVersion: "4.0.0b1" },
      expected: true,
      label: "python 4.0.0b1 (pep440 beta shorthand at minimum)",
    },
    {
      input: { sdkName: "python", sdkVersion: "3.9.0-rc.1" },
      expected: false,
      label: "python 3.9.0-rc.1 (pre-release below minimum)",
    },

    // Unknown / missing SDK name
    {
      input: { sdkName: "ruby", sdkVersion: "1.0.0" },
      expected: false,
      label: "unknown SDK name",
    },
    {
      input: { sdkName: "python" },
      expected: false,
      label: "sdkName without sdkVersion",
    },
    {
      input: { sdkVersion: "4.0.0" },
      expected: false,
      label: "sdkVersion without sdkName",
    },

    // Malformed versions
    {
      input: { sdkName: "python", sdkVersion: "not-a-version" },
      expected: false,
      label: "non-semver sdkVersion",
    },
    {
      input: { sdkName: "python", sdkVersion: "" },
      expected: false,
      label: "empty sdkVersion",
    },

    // ingestionVersion
    {
      input: { ingestionVersion: "4" },
      expected: true,
      label: "ingestionVersion '4'",
    },
    {
      input: {
        ingestionVersion: "4",
        sdkName: undefined,
        sdkVersion: undefined,
      },
      expected: true,
      label: "ingestionVersion '4' without SDK headers",
    },
    {
      input: { ingestionVersion: "3" },
      expected: false,
      label: "ingestionVersion '3' (below)",
    },
    {
      input: { ingestionVersion: "1" },
      expected: false,
      label: "ingestionVersion '1' (below)",
    },
    {
      input: { sdkName: "python", sdkVersion: "3.0.0", ingestionVersion: "4" },
      expected: true,
      label: "ingestionVersion '4' overrides old SDK version",
    },

    // No headers
    { input: {}, expected: false, label: "empty input" },
    {
      input: {
        sdkName: undefined,
        sdkVersion: undefined,
        ingestionVersion: undefined,
      },
      expected: false,
      label: "all undefined",
    },
  ])("$label → $expected", ({ input, expected }) => {
    expect(checkHeaderBasedDirectWrite(input)).toBe(expected);
  });
});

describe("checkSdkVersionRequirements (legacy fallback)", () => {
  it.each<{
    sdkInfo: SdkInfo;
    isExperiment: boolean;
    expected: boolean;
    label: string;
  }>([
    {
      sdkInfo: {
        scopeName: "openlit",
        scopeVersion: "3.9.0",
        telemetrySdkLanguage: "python",
      },
      isExperiment: true,
      expected: false,
      label: "non-Langfuse scope name",
    },
    {
      sdkInfo: {
        scopeName: "langfuse-sdk",
        scopeVersion: "3.9.0",
        telemetrySdkLanguage: "python",
      },
      isExperiment: false,
      expected: false,
      label: "experiment batch false",
    },
    {
      sdkInfo: {
        scopeName: "langfuse-sdk",
        scopeVersion: "3.9.0",
        telemetrySdkLanguage: "python",
      },
      isExperiment: true,
      expected: true,
      label: "python 3.9.0 (exact minimum)",
    },
    {
      sdkInfo: {
        scopeName: "langfuse-sdk",
        scopeVersion: "4.4.0",
        telemetrySdkLanguage: "js",
      },
      isExperiment: true,
      expected: true,
      label: "js 4.4.0 (exact minimum)",
    },
  ])("$label → $expected", ({ sdkInfo, isExperiment, expected }) => {
    expect(checkSdkVersionRequirements(sdkInfo, isExperiment)).toBe(expected);
  });
});

describe("getSdkInfoFromResourceSpans (legacy fallback)", () => {
  it.each<{
    input: Parameters<typeof getSdkInfoFromResourceSpans>[0];
    expected: ReturnType<typeof getSdkInfoFromResourceSpans>;
    label: string;
  }>([
    {
      input: {
        resource: {
          attributes: [
            { key: "telemetry.sdk.language", value: { stringValue: "python" } },
          ],
        },
        scopeSpans: [
          { scope: { name: "langfuse-sdk", version: "3.14.1" }, spans: [] },
        ],
      },
      expected: {
        scopeName: "langfuse-sdk",
        scopeVersion: "3.14.1",
        telemetrySdkLanguage: "python",
      },
      label: "well-formed input",
    },
    {
      input: {},
      expected: {
        scopeName: null,
        scopeVersion: null,
        telemetrySdkLanguage: null,
      },
      label: "empty input",
    },
  ])("$label", ({ input, expected }) => {
    expect(getSdkInfoFromResourceSpans(input)).toEqual(expected);
  });
});

describe("processOtelTraceEvents", () => {
  it("keeps the existing processEventBatch path when direct trace writes are disabled", async () => {
    env.LANGFUSE_OTEL_TRACE_DIRECT_WRITE = "false";

    const traces = [
      makeTraceEvent({
        id: "trace-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    ];
    const processBatch = vi
      .fn()
      .mockResolvedValue({ successes: [], errors: [] });
    const ingestionService = {
      mergeAndWrite: vi.fn().mockResolvedValue(undefined),
    };

    await processOtelTraceEvents({
      traces,
      auth,
      ingestionService,
      shouldForwardToEventsTable: true,
      processBatch,
    });

    expect(processBatch).toHaveBeenCalledTimes(1);
    expect(processBatch).toHaveBeenCalledWith(traces, auth, {
      delay: 0,
      source: "otel",
      forwardToEventsTable: true,
    });
    expect(ingestionService.mergeAndWrite).not.toHaveBeenCalled();
  });

  it("writes trace groups directly when direct trace writes are enabled", async () => {
    env.LANGFUSE_OTEL_TRACE_DIRECT_WRITE = "true";

    const traceA1 = makeTraceEvent({
      id: "trace-a",
      timestamp: "2026-01-01T00:00:00.000Z",
      name: "shallow",
    });
    const traceA2 = makeTraceEvent({
      id: "trace-a",
      timestamp: "2026-01-01T00:00:01.000Z",
      name: "full",
      input: { prompt: "hello" },
      output: { completion: "world" },
    });
    const traceB = makeTraceEvent({
      id: "trace-b",
      timestamp: "2026-01-01T00:00:02.000Z",
      name: "other",
    });
    const traces = [traceA1, traceB, traceA2];
    const processBatch = vi
      .fn()
      .mockResolvedValue({ successes: [], errors: [] });
    const ingestionService = {
      mergeAndWrite: vi.fn().mockResolvedValue(undefined),
    };

    await processOtelTraceEvents({
      traces,
      auth,
      ingestionService,
      shouldForwardToEventsTable: true,
      processBatch,
    });

    expect(processBatch).not.toHaveBeenCalled();
    expect(ingestionService.mergeAndWrite).toHaveBeenCalledTimes(2);
    expect(ingestionService.mergeAndWrite).toHaveBeenCalledWith(
      "trace",
      "project-1",
      "trace-a",
      expect.any(Date),
      [traceA1, traceA2],
      true,
    );
    expect(ingestionService.mergeAndWrite).toHaveBeenCalledWith(
      "trace",
      "project-1",
      "trace-b",
      expect.any(Date),
      [traceB],
      true,
    );
  });

  it("keeps trace sampling semantics when direct trace writes are enabled", async () => {
    env.LANGFUSE_OTEL_TRACE_DIRECT_WRITE = "true";

    const sampledTrace = makeTraceEvent({
      id: "trace-in",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    const sampledOutTrace = makeTraceEvent({
      id: "trace-out",
      timestamp: "2026-01-01T00:00:01.000Z",
    });
    const processBatch = vi
      .fn()
      .mockResolvedValue({ successes: [], errors: [] });
    const ingestionService = {
      mergeAndWrite: vi.fn().mockResolvedValue(undefined),
    };
    const traceSampler = vi.fn(({ event }) => ({
      isSampled: event.body.id !== "trace-out",
      isSamplingConfigured: true,
    }));

    await processOtelTraceEvents({
      traces: [sampledTrace, sampledOutTrace],
      auth,
      ingestionService,
      shouldForwardToEventsTable: false,
      processBatch,
      traceSampler,
    });

    expect(processBatch).not.toHaveBeenCalled();
    expect(traceSampler).toHaveBeenCalledTimes(2);
    expect(ingestionService.mergeAndWrite).toHaveBeenCalledTimes(1);
    expect(ingestionService.mergeAndWrite).toHaveBeenCalledWith(
      "trace",
      "project-1",
      "trace-in",
      expect.any(Date),
      [sampledTrace],
      false,
    );
  });

  it("keeps event order within each trace group so IngestionService owns merge semantics", () => {
    const shallowTrace = makeTraceEvent({
      id: "trace-a",
      timestamp: "2026-01-01T00:00:00.000Z",
      name: "shallow",
    });
    const otherTrace = makeTraceEvent({
      id: "trace-b",
      timestamp: "2026-01-01T00:00:00.500Z",
      name: "other",
    });
    const fullTrace = makeTraceEvent({
      id: "trace-a",
      timestamp: "2026-01-01T00:00:01.000Z",
      name: "full",
      input: { prompt: "hello" },
      output: { completion: "world" },
    });

    expect(
      Array.from(
        groupIngestionEventsByBodyId([
          shallowTrace,
          otherTrace,
          fullTrace,
        ]).entries(),
      ),
    ).toEqual([
      ["trace-a", [shallowTrace, fullTrace]],
      ["trace-b", [otherTrace]],
    ]);
  });
});
