import { ethers } from "hardhat";

async function main(): Promise<void> {
    const block = await ethers.provider.getBlock("latest");

    if (!block) {
        throw new Error("Unable to read latest block.");
    }

    const localTimestamp = Math.floor(Date.now() / 1000);

    console.log("\n========== CHAIN TIME DIAGNOSTIC ==========");
    console.log("Local time:", new Date().toISOString());
    console.log("Local Unix timestamp:", localTimestamp);
    console.log("Latest block number:", block.number);
    console.log("Latest block timestamp:", block.timestamp);
    console.log(
        "Latest block UTC:",
        new Date(block.timestamp * 1000).toISOString()
    );
    console.log(
        "Local time minus block time (seconds):",
        localTimestamp - block.timestamp
    );
    console.log("===========================================\n");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
