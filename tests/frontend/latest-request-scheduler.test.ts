import { createLatestRequestScheduler } from "@/features/language/latest-request-scheduler";

describe("latest request scheduler", () => {
  it("runs one request and retains only the latest pending request", async () => {
    const events: string[] = [];
    let finishFirst: (value: string) => void = () => undefined;
    const first = new Promise<string>((resolve) => {
      finishFirst = resolve;
    });
    const scheduler = createLatestRequestScheduler();

    const firstOutcome = scheduler.schedule(async () => {
      events.push("first-start");
      return first;
    });
    const secondOutcome = scheduler.schedule(async () => {
      events.push("second-start");
      return "second";
    });
    const thirdOutcome = scheduler.schedule(async () => {
      events.push("third-start");
      return "third";
    });

    await expect(secondOutcome).resolves.toEqual({ status: "superseded", generation: 2 });
    expect(events).toEqual(["first-start"]);

    finishFirst("first");
    await expect(firstOutcome).resolves.toEqual(expect.objectContaining({ status: "superseded", generation: 1 }));
    await expect(thirdOutcome).resolves.toEqual(expect.objectContaining({ status: "completed", value: "third" }));
    expect(events).toEqual(["first-start", "third-start"]);
    expect(scheduler.snapshot()).toMatchObject({
      running: false,
      pending: false,
      submitted: 3,
      completed: 1,
      superseded: 2,
    });
  });

  it("suppresses an in-flight result after cancellation", async () => {
    let finish: (value: string) => void = () => undefined;
    const operation = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const scheduler = createLatestRequestScheduler();

    const outcome = scheduler.schedule(() => operation);
    scheduler.cancel();
    finish("stale");

    await expect(outcome).resolves.toEqual({ status: "superseded", generation: 1 });
  });

  it("does not let a stale failure reject the active UI flow", async () => {
    let fail: (error: Error) => void = () => undefined;
    const operation = new Promise<string>((_resolve, reject) => {
      fail = reject;
    });
    const scheduler = createLatestRequestScheduler();

    const stale = scheduler.schedule(() => operation);
    const latest = scheduler.schedule(async () => "latest");
    fail(new Error("stale failure"));

    await expect(stale).resolves.toEqual({ status: "superseded", generation: 1 });
    await expect(latest).resolves.toEqual(expect.objectContaining({ status: "completed", value: "latest" }));
  });

  it("bounds a high-frequency burst to the running request and latest request", async () => {
    let finishFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const scheduler = createLatestRequestScheduler();
    const executed: number[] = [];
    const requests = [scheduler.schedule(async () => {
      executed.push(0);
      await firstGate;
      return 0;
    })];

    for (let index = 1; index <= 100; index += 1) {
      requests.push(scheduler.schedule(async () => {
        executed.push(index);
        return index;
      }));
    }
    finishFirst();
    const outcomes = await Promise.all(requests);

    expect(executed).toEqual([0, 100]);
    expect(outcomes.filter((outcome) => outcome.status === "superseded")).toHaveLength(100);
    expect(scheduler.snapshot()).toMatchObject({ submitted: 101, completed: 1, superseded: 100 });
  });
});
