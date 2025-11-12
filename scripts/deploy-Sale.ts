import { ethers, upgrades } from "hardhat";

async function main() {
    const getSigners = await ethers.getSigners();
    console.log("deploy address: ", getSigners[0].address);

    const defaultAdmin = getSigners[0].address;
    const pauser = getSigners[0].address;
    const upgrader = getSigners[0].address;

    const getContractFactory = await ethers.getContractFactory("Sale");

    const deployProxy = await upgrades.deployProxy(getContractFactory, [defaultAdmin, pauser, upgrader], {
        kind: "uups",
    });
    console.log("Sale address: ", deployProxy.target);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});