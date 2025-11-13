import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre from "hardhat";

// 更新全局信息
// 悬崖期，按秒
let cliffTime = 180 * 24 * 60 * 60; // 180 day
// 开始时间，按秒
let startTimestamp = 200; // 当前时间 + 200 s
// 持续时间，按秒
let durationTime = 365 * 24 * 60 * 60; // 1 year
// tge 时间，按秒
let tgeTimestamp = 200; // 当前时间 + 200 s
// tge 时释放的百分比
const tgePercentage = 2000; // 20% at TGE
// 充入 VestingWalletProxy 的代币数量
const vestingWalletProxyTokenAmount = hre.ethers.parseEther("100000000");

describe("VestingWallet", function () {
  async function deployFixture() {
    const [owner, user1, user2, user3] = await hre.ethers.getSigners();
    console.log("deploy address: ", owner.address);

    const recipient = owner.address;
    const getTestTokenContractFactory = await hre.ethers.getContractFactory("TestToken");
    const TestToken = await getTestTokenContractFactory.deploy(recipient);
    console.log("TestToken address: ", TestToken.target);

    const defaultAdmin = owner.address;
    const pauser = owner.address;
    const upgrader = owner.address;
    const manager = owner.address;
    const getVestingWalletContractFactory = await hre.ethers.getContractFactory("VestingWallet");
    const VestingWalletProxy = await hre.upgrades.deployProxy(getVestingWalletContractFactory, [defaultAdmin, pauser, upgrader, manager, TestToken.target], {
      kind: "uups",
    });
    console.log("VestingWallet proxy address: ", VestingWalletProxy.target);

    // transfer
    await TestToken.transfer(VestingWalletProxy.target, vestingWalletProxyTokenAmount);

    // 获取当前区块时间
    const latestBlock = await hre.ethers.provider.getBlock("latest");
    const currentTime = latestBlock?.timestamp!;
    startTimestamp += currentTime;
    tgeTimestamp += currentTime;
    await VestingWalletProxy.updateVestingInfo(cliffTime, startTimestamp, durationTime, tgeTimestamp, tgePercentage)

    return { owner, user1, user2, user3, TestToken, VestingWalletProxy };
  }

  describe("Deployment", function () {
    it("Should assign roles to the deployer and assign token address", async function () {
      const { owner, user1, user2, user3, TestToken, VestingWalletProxy } = await loadFixture(deployFixture);

      const DEFAULT_ADMIN_ROLE = await VestingWalletProxy.DEFAULT_ADMIN_ROLE();
      const PAUSER_ROLE = await VestingWalletProxy.PAUSER_ROLE();
      const UPGRADER_ROLE = await VestingWalletProxy.UPGRADER_ROLE();
      const VEST_MANAGER_ROLE = await VestingWalletProxy.VEST_MANAGER_ROLE();
      expect(await VestingWalletProxy.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.equal(true);
      expect(await VestingWalletProxy.hasRole(PAUSER_ROLE, owner.address)).to.equal(true);
      expect(await VestingWalletProxy.hasRole(UPGRADER_ROLE, owner.address)).to.equal(true);
      expect(await VestingWalletProxy.hasRole(VEST_MANAGER_ROLE, owner.address)).to.equal(true);

      const tokenAddress = await VestingWalletProxy.tokenAddress();
      expect(TestToken.target == tokenAddress).to.equal(true);
    });

    it("Should updateVestingInfo right", async function () {
      const { owner, user1, user2, user3, TestToken, VestingWalletProxy } = await loadFixture(deployFixture);

      const getVestingInfo = await VestingWalletProxy.getVestingInfo();
      expect(getVestingInfo.cliffTime).to.equal(cliffTime);
      expect(getVestingInfo.startTimestamp).to.equal(startTimestamp);
      expect(getVestingInfo.durationTime).to.equal(durationTime);
      expect(getVestingInfo.tgeTimestamp).to.equal(tgeTimestamp);
      expect(getVestingInfo.tgeTimestamp).to.equal(tgeTimestamp);
    });
  });

  describe("addSchedule", function () {
    it("Should addSchedule by VEST_MANAGER_ROLE", async function () {
      const { owner, user1, user2, user3, TestToken, VestingWalletProxy } = await loadFixture(deployFixture);

      const currentScheduleId = await VestingWalletProxy.currentScheduleId();
      expect(currentScheduleId == BigInt(0)).to.equal(true);

      const beneficiary = user1.address;
      const tokenAmount = hre.ethers.parseEther("100");
      expect(await VestingWalletProxy.addSchedule(beneficiary, tokenAmount)).to.emit(VestingWalletProxy, "AddSchedule").withArgs(currentScheduleId + BigInt(1), beneficiary, tokenAmount);

      const currentScheduleId1 = await VestingWalletProxy.currentScheduleId();
      expect(currentScheduleId1 == BigInt(1)).to.equal(true);

      const getScheduleIdsOfBeneficiary = await VestingWalletProxy.getScheduleIdsOfBeneficiary(beneficiary);
      expect(getScheduleIdsOfBeneficiary.length).to.equal(1);
      expect(getScheduleIdsOfBeneficiary[0]).to.equal(1);

      const getScheduleInfoById = await VestingWalletProxy.getScheduleInfoById(currentScheduleId1);
      expect(getScheduleInfoById.beneficiary).to.equal(beneficiary);
      expect(getScheduleInfoById.totalAmount).to.equal(tokenAmount);
      expect(getScheduleInfoById.tgeAmount).to.equal(0);
      expect(getScheduleInfoById.released).to.equal(0);
      expect(getScheduleInfoById.tgeClaimed).to.equal(false);
      expect(getScheduleInfoById.cliff).to.equal(cliffTime);
      expect(getScheduleInfoById.start).to.equal(startTimestamp);
      expect(getScheduleInfoById.duration).to.equal(durationTime);
      expect(getScheduleInfoById.tgePercentage).to.equal(tgePercentage);
      expect(getScheduleInfoById.vested).to.equal(0);
      expect(getScheduleInfoById.claimable).to.equal(0);
      expect(getScheduleInfoById.cliffPassed).to.equal(false);
    });

    it("Should not addSchedule by others", async function () {
      const { owner, user1, user2, user3, TestToken, VestingWalletProxy } = await loadFixture(deployFixture);
      const beneficiary = user1.address;
      const tokenAmount = hre.ethers.parseEther("100");
      await expect(VestingWalletProxy.connect(user1).addSchedule(beneficiary, tokenAmount)).to.be.revertedWithCustomError(VestingWalletProxy, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, await VestingWalletProxy.VEST_MANAGER_ROLE());
    });
  });

  describe("claimTgeAmount", function () {
    it("Should claim the tgePercentage amount", async function () {
      const { owner, user1, user2, user3, TestToken, VestingWalletProxy } = await loadFixture(deployFixture);

      const currentScheduleId = await VestingWalletProxy.currentScheduleId();
      expect(currentScheduleId == BigInt(0)).to.equal(true);

      const beneficiary = user1.address;
      const tokenAmount = hre.ethers.parseEther("100");
      expect(await VestingWalletProxy.addSchedule(beneficiary, tokenAmount)).to.emit(VestingWalletProxy, "AddSchedule").withArgs(currentScheduleId + BigInt(1), beneficiary, tokenAmount);

      const currentScheduleId1 = await VestingWalletProxy.currentScheduleId();
      expect(currentScheduleId1 == BigInt(1)).to.equal(true);

      const getScheduleIdsOfBeneficiary = await VestingWalletProxy.getScheduleIdsOfBeneficiary(beneficiary);
      expect(getScheduleIdsOfBeneficiary.length).to.equal(1);
      expect(getScheduleIdsOfBeneficiary[0]).to.equal(1);

      const getScheduleInfoById = await VestingWalletProxy.getScheduleInfoById(currentScheduleId1);
      expect(getScheduleInfoById.beneficiary).to.equal(user1.address);
      expect(getScheduleInfoById.totalAmount).to.equal(tokenAmount);
      expect(getScheduleInfoById.tgeAmount).to.equal(0);
      expect(getScheduleInfoById.released).to.equal(0);
      expect(getScheduleInfoById.tgeClaimed).to.equal(false);
      expect(getScheduleInfoById.cliff).to.equal(cliffTime);
      expect(getScheduleInfoById.start).to.equal(startTimestamp);
      expect(getScheduleInfoById.duration).to.equal(durationTime);
      expect(getScheduleInfoById.tgePercentage).to.equal(tgePercentage);
      expect(getScheduleInfoById.vested).to.equal(0);
      expect(getScheduleInfoById.claimable).to.equal(0);
      expect(getScheduleInfoById.cliffPassed).to.equal(false);

      await expect(VestingWalletProxy.connect(user1).claimTgeAmount(currentScheduleId1)).to.be.revertedWith("Invalid tge timestamp");

      // 到了 tge 时间，可以领取 tge 释放部分数量
      await time.increaseTo(tgeTimestamp);

      // 可以计算到 tge 数量
      const tgeAmount = tokenAmount * BigInt(tgePercentage) / BigInt(10000);
      const getScheduleInfoById2 = await VestingWalletProxy.getScheduleInfoById(currentScheduleId1);
      expect(getScheduleInfoById2.tgeAmount).to.equal(tgeAmount);
      expect(getScheduleInfoById2.tgeClaimed).to.equal(false);

      // claimTgeAmount error
      await expect(VestingWalletProxy.connect(user2).claimTgeAmount(currentScheduleId1)).to.be.revertedWith("Sender should be beneficiary");
      await expect(VestingWalletProxy.connect(user1).claimTgeAmount(currentScheduleId)).to.be.revertedWith("Invalid schedule id");

      const VestingWalletProxyBalanceBefore = await TestToken.balanceOf(VestingWalletProxy.target);
      expect(VestingWalletProxyBalanceBefore).to.equal(vestingWalletProxyTokenAmount);

      // claimTgeAmount success
      expect(await VestingWalletProxy.connect(user1).claimTgeAmount(currentScheduleId1)).to.be.emit(VestingWalletProxy, "ClaimTgeAmount").withArgs(currentScheduleId1, user1.address, getScheduleInfoById2.tgeAmount);

      const VestingWalletProxyBalanceAfter = await TestToken.balanceOf(VestingWalletProxy.target);
      expect(VestingWalletProxyBalanceAfter).to.equal(vestingWalletProxyTokenAmount - tgeAmount);

      // 可以计算到 tge 数量
      const getScheduleInfoById3 = await VestingWalletProxy.getScheduleInfoById(currentScheduleId1);
      expect(getScheduleInfoById3.beneficiary).to.equal(user1.address);
      expect(getScheduleInfoById3.totalAmount).to.equal(tokenAmount);
      expect(getScheduleInfoById3.tgeAmount).to.equal(tgeAmount);
      expect(getScheduleInfoById3.released).to.equal(0);
      expect(getScheduleInfoById3.tgeClaimed).to.equal(true);
      expect(getScheduleInfoById3.cliff).to.equal(cliffTime);
      expect(getScheduleInfoById3.start).to.equal(startTimestamp);
      expect(getScheduleInfoById3.duration).to.equal(durationTime);
      expect(getScheduleInfoById3.tgePercentage).to.equal(tgePercentage);
      expect(getScheduleInfoById3.vested).to.equal(0);
      expect(getScheduleInfoById3.claimable).to.equal(0);
      expect(getScheduleInfoById3.cliffPassed).to.equal(false);

      // 不能重复领
      await expect(VestingWalletProxy.connect(user1).claimTgeAmount(currentScheduleId1)).to.be.revertedWith("Already claimed");
    });
  });


  describe("claim", function () {
    it("Should claim the releaseable amount", async function () {
      const { owner, user1, user2, user3, TestToken, VestingWalletProxy } = await loadFixture(deployFixture);

      const currentScheduleId = await VestingWalletProxy.currentScheduleId();
      expect(currentScheduleId == BigInt(0)).to.equal(true);

      const beneficiary = user1.address;
      const tokenAmount = hre.ethers.parseEther("100");
      expect(await VestingWalletProxy.addSchedule(beneficiary, tokenAmount)).to.emit(VestingWalletProxy, "AddSchedule").withArgs(currentScheduleId + BigInt(1), beneficiary, tokenAmount);

      const currentScheduleId1 = await VestingWalletProxy.currentScheduleId();
      expect(currentScheduleId1 == BigInt(1)).to.equal(true);

      const getScheduleIdsOfBeneficiary = await VestingWalletProxy.getScheduleIdsOfBeneficiary(beneficiary);
      expect(getScheduleIdsOfBeneficiary.length).to.equal(1);
      expect(getScheduleIdsOfBeneficiary[0]).to.equal(1);

      const getScheduleInfoById = await VestingWalletProxy.getScheduleInfoById(currentScheduleId1);
      expect(getScheduleInfoById.beneficiary).to.equal(user1.address);
      expect(getScheduleInfoById.totalAmount).to.equal(tokenAmount);
      expect(getScheduleInfoById.tgeAmount).to.equal(0);
      expect(getScheduleInfoById.released).to.equal(0);
      expect(getScheduleInfoById.tgeClaimed).to.equal(false);
      expect(getScheduleInfoById.cliff).to.equal(cliffTime);
      expect(getScheduleInfoById.start).to.equal(startTimestamp);
      expect(getScheduleInfoById.duration).to.equal(durationTime);
      expect(getScheduleInfoById.tgePercentage).to.equal(tgePercentage);
      expect(getScheduleInfoById.vested).to.equal(0);
      expect(getScheduleInfoById.claimable).to.equal(0);
      expect(getScheduleInfoById.cliffPassed).to.equal(false);

      await expect(VestingWalletProxy.connect(user1).claim(currentScheduleId)).to.be.revertedWith("Invalid schedule id");
      await expect(VestingWalletProxy.connect(user2).claim(currentScheduleId1)).to.be.revertedWith("Sender should be beneficiary");
      await expect(VestingWalletProxy.connect(user1).claim(currentScheduleId1)).to.be.revertedWith("Claimable amount is zero");


      // 每秒可以领取的数量
      const releaseAmoutPerSec = tokenAmount / BigInt(durationTime);

      // 到了开始时间+悬崖期+100s
      await time.increaseTo(startTimestamp + cliffTime + 100);

      // releaseAmoutPerSec * BigInt(100) = 317097919837600
      // contract                         = 317097919837645
      expect(await VestingWalletProxy.getClaimableAmountByScheduleId(currentScheduleId1)).to.be.equal("317097919837645");

      // 可以计算到 tge 数量
      const getScheduleInfoById3 = await VestingWalletProxy.getScheduleInfoById(currentScheduleId1);
      expect(getScheduleInfoById3.beneficiary).to.equal(user1.address);
      expect(getScheduleInfoById3.totalAmount).to.equal(tokenAmount);
      expect(getScheduleInfoById3.tgeAmount).to.equal(tokenAmount * BigInt(tgePercentage) / BigInt(10000));
      expect(getScheduleInfoById3.released).to.equal(0);
      expect(getScheduleInfoById3.tgeClaimed).to.equal(false);
      expect(getScheduleInfoById3.cliff).to.equal(cliffTime);
      expect(getScheduleInfoById3.start).to.equal(startTimestamp);
      expect(getScheduleInfoById3.duration).to.equal(durationTime);
      expect(getScheduleInfoById3.tgePercentage).to.equal(tgePercentage);
      expect(getScheduleInfoById3.vested).to.equal("317097919837645");
      expect(getScheduleInfoById3.claimable).to.equal("317097919837645");
      expect(getScheduleInfoById3.cliffPassed).to.equal(true);
    });
  });
});
