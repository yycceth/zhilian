import { ethers } from "hardhat";
import { Sale__factory } from "../typechain-types";

async function main() {
    let getSigners = await ethers.getSigners();
    console.log("deploy address: ", getSigners[0].address);

    let getContractFactory = await ethers.getContractFactory("Sale");
    const attach = getContractFactory.attach(process.env.SaleAddress!);
    console.log("Sale attached: ", attach.target);

    // deploy new implementation
    const newSale = await getContractFactory.deploy();
    console.log("New Sale deployed to:", newSale.target);
    // upgrade
    const attachFactory = Sale__factory.connect(attach.target.toString(), getSigners[0]);
    await attachFactory.upgradeToAndCall(newSale.target, "0x");
    console.log("Sale upgraded");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});