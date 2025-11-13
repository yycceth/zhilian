import { ethers } from "hardhat";

async function main() {
  let getSigners = await ethers.getSigners();
  console.log("deploy address: ", getSigners[0].address);

  let getContractFactory = await ethers.getContractFactory("TestToken");

  let deploy = await getContractFactory.deploy(getSigners[0].address);
  console.log("TestToken address: ", deploy.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
