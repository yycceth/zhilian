import { ethers, upgrades } from "hardhat";

async function main() {
    const getSigners = await ethers.getSigners();
    console.log("deploy address: ", getSigners[0].address);

    const defaultAdmin = getSigners[0].address;
    const pauser = getSigners[0].address;
    const upgrader = getSigners[0].address;

    const getContractFactory = await ethers.getContractFactory("VestingWallet");

    const deployProxy = await upgrades.deployProxy(getContractFactory, [defaultAdmin, pauser, upgrader], {
        kind: "uups",
    });
    console.log("VestingWallet address: ", deployProxy.target);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});