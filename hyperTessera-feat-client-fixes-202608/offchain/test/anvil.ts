import { spawn, type ChildProcess } from "node:child_process";
import { JsonRpcProvider, Wallet } from "ethers";

export interface AnvilInstance {
  process: ChildProcess;
  provider: JsonRpcProvider;
  wallets: Wallet[];
  stop: () => void;
}

/** Starts a local anvil node, parses its printed private keys, and returns ready-to-use signers. */
export async function startAnvil(port = 8552): Promise<AnvilInstance> {
  const proc = spawn("anvil", ["--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });

  let output = "";
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Listening on")) {
        proc.stdout?.off("data", onData);
        // Keep draining (and discarding) anvil's per-transaction log output: with the last 'data'
        // listener removed the pipe stops being read, and once its buffer fills anvil blocks on
        // write and stops mining — which surfaces as "Transaction dropped from the mempool".
        proc.stdout?.resume();
        resolve();
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.resume(); // never read — drain it so a full stderr pipe can't block anvil either
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`anvil exited early with code ${code}`));
    });
    setTimeout(() => reject(new Error("anvil did not start within 15s")), 15_000);
  });

  const keyLines = output.split("\n").filter((l) => /^\(\d+\)\s+0x[0-9a-fA-F]{64}/.test(l.trim()));
  const privateKeys = keyLines.map((l) => l.trim().match(/0x[0-9a-fA-F]{64}/)![0]);
  if (privateKeys.length === 0) throw new Error("Could not parse anvil private keys from stdout");

  // cacheTimeout must be disabled: ethers caches read-only RPC results (incl. getTransactionCount)
  // for 250ms by default, which is longer than an anvil block on this fast local loop and causes
  // stale-nonce ("nonce too low") errors across back-to-back deploy transactions.
  const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
  const wallets = privateKeys.map((pk) => new Wallet(pk, provider));

  return {
    process: proc,
    provider,
    wallets,
    stop: () => proc.kill(),
  };
}
