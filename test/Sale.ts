import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Sale, TestToken, VestingWallet } from "../typechain-types";

describe("Sale", function () {
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

  let owner: any;
  let consignee1: any;
  let consignee2: any;
  let user1: any;
  let user2: any;
  let user3: any;
  let rvt: TestToken;
  let vestingWallet: VestingWallet;
  let sale: Sale;
  const TOTAL_SUPPLY = ethers.parseEther("10000000000"); // 10 billion tokens


  beforeEach(async function () {
    [owner, consignee1, consignee2, user1, user2, user3] = await ethers.getSigners();

    const recipient = owner.address;
    const getTestTokenContractFactory = await ethers.getContractFactory("TestToken");
    const TestToken = await getTestTokenContractFactory.deploy(recipient);
    console.log("TestToken address: ", TestToken.target);
    rvt = TestToken;

    const defaultAdmin = owner.address;
    const pauser = owner.address;
    const upgrader = owner.address;
    const manager = owner.address;
    const getVestingWalletContractFactory = await ethers.getContractFactory("VestingWallet");
    const VestingWalletProxy = await upgrades.deployProxy(getVestingWalletContractFactory, [defaultAdmin, pauser, upgrader, manager, TestToken.target], {
      kind: "uups",
    });
    console.log("VestingWallet proxy address: ", VestingWalletProxy.target);
    vestingWallet = VestingWalletProxy;

    // 获取当前区块时间
    const latestBlock = await ethers.provider.getBlock("latest");
    const currentTime = latestBlock?.timestamp!;
    startTimestamp += currentTime;
    tgeTimestamp += currentTime;
    await VestingWalletProxy.updateVestingInfo(cliffTime, startTimestamp, durationTime, tgeTimestamp, tgePercentage);

    const operator = owner.address;
    const getContractFactory = await ethers.getContractFactory("Sale");
    const saleProxy = await upgrades.deployProxy(getContractFactory, [defaultAdmin, pauser, upgrader, operator, VestingWalletProxy.target], {
      kind: "uups",
    });
    console.log("Sale proxy address: ", saleProxy.target);
    sale = saleProxy;

    // setting
    const VEST_MANAGER_ROLE = await VestingWalletProxy.VEST_MANAGER_ROLE();
    await VestingWalletProxy.grantRole(VEST_MANAGER_ROLE, saleProxy.target);
  });

  describe("Deployment", function () {
    it("Should assign roles to the deployer", async function () {
      const defaultAdminRole = await sale.DEFAULT_ADMIN_ROLE();
      const operator_role = await sale.OPERATOR_ROLE();

      expect(await sale.hasRole(defaultAdminRole, owner.address)).to.equal(true);
      expect(await sale.hasRole(operator_role, owner.address)).to.equal(true);
    });
  });

  describe("addConsignee", function () {
    it("Should addConsignee by operator_role", async function () {
      expect(await sale.isConsignee(consignee1.address)).to.equal(false);
      const tokenAmount = ethers.parseEther("1000");
      await sale.connect(owner).addConsignee(consignee1.address, tokenAmount);
      expect(await sale.isConsignee(consignee1.address)).to.equal(true);

      const consigneeInfo = await sale.getConsigneeInfo(consignee1.address);
      expect(consigneeInfo.totalTokenAmount).to.equal(tokenAmount);
      expect(consigneeInfo.soldTokenAmount).to.equal(0);

      const allConsigneeInfo = await sale.getAllConsigneeInfo();
      expect(allConsigneeInfo.length).to.equal(1);
      expect(allConsigneeInfo[0].totalTokenAmount).to.equal(tokenAmount);
      expect(allConsigneeInfo[0].soldTokenAmount).to.equal(0);

      const allConsigneesLength = await sale.getAllConsigneesLength();
      expect(allConsigneesLength).to.equal(1);

      const allConsignees = await sale.getAllConsignees();
      expect(allConsignees[0]).to.equal(consignee1.address);
    });

    it("Should not addConsignee by user", async function () {
      const tokenAmount = ethers.parseEther("1000");
      await expect(
        sale.connect(user1).addConsignee(consignee1.address, tokenAmount)
      ).to.be.revertedWithCustomError(sale, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, await sale.OPERATOR_ROLE());
    });
  });


  describe("batchAddConsignee", function () {
    it("Should batchAddConsignee by operator_role", async function () {
      const tokenAmount1 = ethers.parseEther("1000");
      const tokenAmount2 = ethers.parseEther("100");
      await sale.connect(owner).batchAddConsignee([consignee1.address, consignee2.address], [tokenAmount1, tokenAmount2]);

      const consigneeInfo = await sale.getConsigneeInfo(consignee1.address);
      expect(consigneeInfo.totalTokenAmount).to.equal(tokenAmount1);
      expect(consigneeInfo.soldTokenAmount).to.equal(0);

      const consigneeInfo2 = await sale.getConsigneeInfo(consignee2.address);
      expect(consigneeInfo2.totalTokenAmount).to.equal(tokenAmount2);
      expect(consigneeInfo2.soldTokenAmount).to.equal(0);

      const allConsigneeInfo = await sale.getAllConsigneeInfo();
      expect(allConsigneeInfo.length).to.equal(2);
      expect(allConsigneeInfo[0].totalTokenAmount).to.equal(tokenAmount1);
      expect(allConsigneeInfo[0].soldTokenAmount).to.equal(0);
      expect(allConsigneeInfo[1].totalTokenAmount).to.equal(tokenAmount2);
      expect(allConsigneeInfo[1].soldTokenAmount).to.equal(0);

      const allConsigneesLength = await sale.getAllConsigneesLength();
      expect(allConsigneesLength).to.equal(2);

      const allConsignees = await sale.getAllConsignees();
      expect(allConsignees[0]).to.equal(consignee1.address);
      expect(allConsignees[1]).to.equal(consignee2.address);
    });

    it("Should not batchAddConsignee by user", async function () {
      const tokenAmount = ethers.parseEther("1000");
      await expect(
        sale.connect(user1).batchAddConsignee([consignee1.address, consignee2.address], [tokenAmount, tokenAmount])
      ).to.be.revertedWithCustomError(sale, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, await sale.OPERATOR_ROLE());
    });
  });

  describe("CreateOfflinePurchase", function () {
    it("Should consigneeCreateOfflinePurchase by consignee", async function () {
      const tokenAmount = ethers.parseEther("1000");
      await sale.connect(owner).addConsignee(consignee1.address, tokenAmount);

      const consigneeInfo = await sale.getConsigneeInfo(consignee1.address);
      expect(consigneeInfo.totalTokenAmount).to.equal(tokenAmount);
      expect(consigneeInfo.soldTokenAmount).to.equal(0);

      const purchaseTokenAmount = ethers.parseEther("100");
      await sale.connect(consignee1).consigneeCreateOfflinePurchase(user1.address, purchaseTokenAmount);

      const consigneeInfoAfter = await sale.getConsigneeInfo(consignee1.address);
      expect(consigneeInfoAfter.totalTokenAmount).to.equal(tokenAmount);
      expect(consigneeInfoAfter.soldTokenAmount).to.equal(purchaseTokenAmount);

      const userPurchaseInfo = await sale.getUserPurchaseInfo(user1.address);
      expect(userPurchaseInfo.length).to.equal(1);
      expect(userPurchaseInfo[0].consigneeAddress).to.equal(consignee1.address);
      expect(userPurchaseInfo[0].tokenAmount).to.equal(purchaseTokenAmount);


      const userPurchaseInfoByConsigneeAddress = await sale.getUserPurchaseInfoByConsigneeAddress(consignee1.address);
      expect(userPurchaseInfoByConsigneeAddress.length).to.equal(1);
      expect(userPurchaseInfoByConsigneeAddress[0].consigneeAddress).to.equal(consignee1.address);
      expect(userPurchaseInfoByConsigneeAddress[0].tokenAmount).to.equal(purchaseTokenAmount);
    });

    it("Should adminCreateOfflinePurchase by operator_role", async function () {
      const tokenAmount = ethers.parseEther("1000");
      await sale.connect(owner).addConsignee(consignee1.address, tokenAmount);

      const consigneeInfo = await sale.getConsigneeInfo(consignee1.address);
      expect(consigneeInfo.totalTokenAmount).to.equal(tokenAmount);
      expect(consigneeInfo.soldTokenAmount).to.equal(0);

      const purchaseTokenAmount = ethers.parseEther("100");
      await sale.connect(owner).adminCreateOfflinePurchase(consignee1.address, user1.address, purchaseTokenAmount);

      const consigneeInfoAfter = await sale.getConsigneeInfo(consignee1.address);
      expect(consigneeInfoAfter.totalTokenAmount).to.equal(tokenAmount);
      expect(consigneeInfoAfter.soldTokenAmount).to.equal(purchaseTokenAmount);

      const userPurchaseInfo = await sale.getUserPurchaseInfo(user1.address);
      expect(userPurchaseInfo.length).to.equal(1);
      expect(userPurchaseInfo[0].consigneeAddress).to.equal(consignee1.address);
      expect(userPurchaseInfo[0].tokenAmount).to.equal(purchaseTokenAmount);


      const userPurchaseInfoByConsigneeAddress = await sale.getUserPurchaseInfoByConsigneeAddress(consignee1.address);
      expect(userPurchaseInfoByConsigneeAddress.length).to.equal(1);
      expect(userPurchaseInfoByConsigneeAddress[0].consigneeAddress).to.equal(consignee1.address);
      expect(userPurchaseInfoByConsigneeAddress[0].tokenAmount).to.equal(purchaseTokenAmount);
    });

    it("Should not consigneeCreateOfflinePurchase by user", async function () {
      const tokenAmount = ethers.parseEther("1000");
      await expect(
        sale.connect(user1).consigneeCreateOfflinePurchase(consignee1.address, tokenAmount)
      ).to.be.revertedWith("Caller is not a registered consignee");
    });

    it("Should not adminCreateOfflinePurchase by user", async function () {
      const tokenAmount = ethers.parseEther("1000");
      await expect(
        sale.connect(user1).adminCreateOfflinePurchase(consignee1.address, user1.address, tokenAmount)
      ).to.be.revertedWithCustomError(sale, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, await sale.OPERATOR_ROLE());
    });
  });

  describe("batchCreateOfflinePurchase", function () {
    it("Should batchConsigneeCreateOfflinePurchase by consignee", async function () {
      const tokenAmount = ethers.parseEther("1000");
      await sale.connect(owner).addConsignee(consignee1.address, tokenAmount);

      const consigneeInfo = await sale.getConsigneeInfo(consignee1.address);
      expect(consigneeInfo.totalTokenAmount).to.equal(tokenAmount);
      expect(consigneeInfo.soldTokenAmount).to.equal(0);

      const purchaseTokenAmount1 = ethers.parseEther("100");
      const purchaseTokenAmount2 = ethers.parseEther("10");
      await sale.connect(consignee1).batchConsigneeCreateOfflinePurchase([user1.address, user2.address], [purchaseTokenAmount1, purchaseTokenAmount2]);

      const consigneeInfoAfter = await sale.getConsigneeInfo(consignee1.address);
      expect(consigneeInfoAfter.totalTokenAmount).to.equal(tokenAmount);
      expect(consigneeInfoAfter.soldTokenAmount).to.equal(purchaseTokenAmount1 + purchaseTokenAmount2);

      const userPurchaseInfo = await sale.getUserPurchaseInfo(user1.address);
      expect(userPurchaseInfo.length).to.equal(1);
      expect(userPurchaseInfo[0].consigneeAddress).to.equal(consignee1.address);
      expect(userPurchaseInfo[0].tokenAmount).to.equal(purchaseTokenAmount1);

      const userPurchaseInfo2 = await sale.getUserPurchaseInfo(user2.address);
      expect(userPurchaseInfo2.length).to.equal(1);
      expect(userPurchaseInfo2[0].consigneeAddress).to.equal(consignee1.address);
      expect(userPurchaseInfo2[0].tokenAmount).to.equal(purchaseTokenAmount2);


      const userPurchaseInfoByConsigneeAddress = await sale.getUserPurchaseInfoByConsigneeAddress(consignee1.address);
      expect(userPurchaseInfoByConsigneeAddress.length).to.equal(2);
      expect(userPurchaseInfoByConsigneeAddress[0].consigneeAddress).to.equal(consignee1.address);
      expect(userPurchaseInfoByConsigneeAddress[0].tokenAmount).to.equal(purchaseTokenAmount1);
      expect(userPurchaseInfoByConsigneeAddress[1].consigneeAddress).to.equal(consignee1.address);
      expect(userPurchaseInfoByConsigneeAddress[1].tokenAmount).to.equal(purchaseTokenAmount2);
    });

    it("Should batchAdminCreateOfflinePurchase by operator_role", async function () {
      const tokenAmount = ethers.parseEther("1000");
      await sale.connect(owner).addConsignee(consignee1.address, tokenAmount);

      const consigneeInfo = await sale.getConsigneeInfo(consignee1.address);
      expect(consigneeInfo.totalTokenAmount).to.equal(tokenAmount);
      expect(consigneeInfo.soldTokenAmount).to.equal(0);

      const purchaseTokenAmount1 = ethers.parseEther("100");
      const purchaseTokenAmount2 = ethers.parseEther("10");
      await sale.connect(owner).batchAdminCreateOfflinePurchase(consignee1.address, [user1.address, user2.address], [purchaseTokenAmount1, purchaseTokenAmount2]);

      const consigneeInfoAfter = await sale.getConsigneeInfo(consignee1.address);
      expect(consigneeInfoAfter.totalTokenAmount).to.equal(tokenAmount);
      expect(consigneeInfoAfter.soldTokenAmount).to.equal(purchaseTokenAmount1 + purchaseTokenAmount2);

      const userPurchaseInfo = await sale.getUserPurchaseInfo(user1.address);
      expect(userPurchaseInfo.length).to.equal(1);
      expect(userPurchaseInfo[0].consigneeAddress).to.equal(consignee1.address);
      expect(userPurchaseInfo[0].tokenAmount).to.equal(purchaseTokenAmount1);

      const userPurchaseInfo2 = await sale.getUserPurchaseInfo(user2.address);
      expect(userPurchaseInfo2.length).to.equal(1);
      expect(userPurchaseInfo2[0].consigneeAddress).to.equal(consignee1.address);
      expect(userPurchaseInfo2[0].tokenAmount).to.equal(purchaseTokenAmount2);


      const userPurchaseInfoByConsigneeAddress = await sale.getUserPurchaseInfoByConsigneeAddress(consignee1.address);
      expect(userPurchaseInfoByConsigneeAddress.length).to.equal(2);
      expect(userPurchaseInfoByConsigneeAddress[0].consigneeAddress).to.equal(consignee1.address);
      expect(userPurchaseInfoByConsigneeAddress[0].tokenAmount).to.equal(purchaseTokenAmount1);
      expect(userPurchaseInfoByConsigneeAddress[1].consigneeAddress).to.equal(consignee1.address);
      expect(userPurchaseInfoByConsigneeAddress[1].tokenAmount).to.equal(purchaseTokenAmount2);
    });

    it("Should not batchConsigneeCreateOfflinePurchase by user", async function () {
      const purchaseTokenAmount1 = ethers.parseEther("100");
      const purchaseTokenAmount2 = ethers.parseEther("10");
      await expect(sale.connect(user1).batchConsigneeCreateOfflinePurchase([user1.address, user2.address], [purchaseTokenAmount1, purchaseTokenAmount2])).to.be.revertedWith("Caller is not a registered consignee");
    });

    it("Should not batchAdminCreateOfflinePurchase by user", async function () {
      const purchaseTokenAmount1 = ethers.parseEther("100");
      const purchaseTokenAmount2 = ethers.parseEther("10");
      await expect(sale.connect(user1).batchAdminCreateOfflinePurchase(consignee1.address, [user1.address, user2.address], [purchaseTokenAmount1, purchaseTokenAmount2])).to.be.revertedWithCustomError(sale, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, await sale.OPERATOR_ROLE());
    });
  });

  describe("batchAddConsignee and CreateOfflinePurchase", function () {
    it("Should batchAddConsignee by operator_role and consigneeCreateOfflinePurchase by consignees", async function () {
      const tokenAmount1 = ethers.parseEther("1000");
      const tokenAmount2 = ethers.parseEther("100");
      await sale.connect(owner).batchAddConsignee([consignee1.address, consignee2.address], [tokenAmount1, tokenAmount2]);

      const consigneeInfo = await sale.getConsigneeInfo(consignee1.address);
      expect(consigneeInfo.totalTokenAmount).to.equal(tokenAmount1);
      expect(consigneeInfo.soldTokenAmount).to.equal(0);

      const consigneeInfo2 = await sale.getConsigneeInfo(consignee2.address);
      expect(consigneeInfo2.totalTokenAmount).to.equal(tokenAmount2);
      expect(consigneeInfo2.soldTokenAmount).to.equal(0);

      const allConsigneeInfo = await sale.getAllConsigneeInfo();
      expect(allConsigneeInfo.length).to.equal(2);
      expect(allConsigneeInfo[0].totalTokenAmount).to.equal(tokenAmount1);
      expect(allConsigneeInfo[0].soldTokenAmount).to.equal(0);
      expect(allConsigneeInfo[1].totalTokenAmount).to.equal(tokenAmount2);
      expect(allConsigneeInfo[1].soldTokenAmount).to.equal(0);

      const allConsigneesLength = await sale.getAllConsigneesLength();
      expect(allConsigneesLength).to.equal(2);

      const allConsignees = await sale.getAllConsignees();
      expect(allConsignees[0]).to.equal(consignee1.address);
      expect(allConsignees[1]).to.equal(consignee2.address);

      // consigneeCreateOfflinePurchase user1 by consignee1
      const purchaseTokenAmount1 = ethers.parseEther("100");
      await sale.connect(consignee1).consigneeCreateOfflinePurchase(user1.address, purchaseTokenAmount1);

      const consigneeInfoAfter1 = await sale.getConsigneeInfo(consignee1.address);
      expect(consigneeInfoAfter1.totalTokenAmount).to.equal(tokenAmount1);
      expect(consigneeInfoAfter1.soldTokenAmount).to.equal(purchaseTokenAmount1);

      // consigneeCreateOfflinePurchase user1 by consignee2
      const purchaseTokenAmount2 = ethers.parseEther("10");
      await sale.connect(consignee2).consigneeCreateOfflinePurchase(user1.address, purchaseTokenAmount2);

      const consigneeInfoAfter2 = await sale.getConsigneeInfo(consignee2.address);
      expect(consigneeInfoAfter2.totalTokenAmount).to.equal(tokenAmount2);
      expect(consigneeInfoAfter2.soldTokenAmount).to.equal(purchaseTokenAmount2);

      const userPurchaseInfo = await sale.getUserPurchaseInfo(user1.address);
      expect(userPurchaseInfo.length).to.equal(2);
      expect(userPurchaseInfo[0].consigneeAddress).to.equal(consignee1.address);
      expect(userPurchaseInfo[0].tokenAmount).to.equal(purchaseTokenAmount1);
      expect(userPurchaseInfo[1].consigneeAddress).to.equal(consignee2.address);
      expect(userPurchaseInfo[1].tokenAmount).to.equal(purchaseTokenAmount2);

      const userPurchaseInfoByConsigneeAddress = await sale.getUserPurchaseInfoByConsigneeAddress(consignee1.address);
      expect(userPurchaseInfoByConsigneeAddress.length).to.equal(1);
      expect(userPurchaseInfoByConsigneeAddress[0].consigneeAddress).to.equal(consignee1.address);
      expect(userPurchaseInfoByConsigneeAddress[0].tokenAmount).to.equal(purchaseTokenAmount1);

      const userPurchaseInfoByConsigneeAddress2 = await sale.getUserPurchaseInfoByConsigneeAddress(consignee2.address);
      expect(userPurchaseInfoByConsigneeAddress2.length).to.equal(1);
      expect(userPurchaseInfoByConsigneeAddress2[0].consigneeAddress).to.equal(consignee2.address);
      expect(userPurchaseInfoByConsigneeAddress2[0].tokenAmount).to.equal(purchaseTokenAmount2);
    });
  });
});
