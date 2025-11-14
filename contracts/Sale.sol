// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.5.0
pragma solidity ^0.8.27;

import {
    AccessControlUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {
    Initializable
} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {
    PausableUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {
    UUPSUpgradeable
} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

interface IVestingWallet {
    function addSchedule(
        address _beneficiary,
        uint96 _tokenAmount
    ) external returns (uint256 scheduleId);

    function battchAddSchedule(
        address[] calldata _beneficiaries,
        uint96[] calldata _tokenAmounts
    ) external;
}

contract Sale is
    Initializable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IVestingWallet public vestingWallet;

    // 记录承销商从项目方购买的信息
    struct ConsigneeInfo {
        uint256 totalTokenAmount; // 购买总数量
        uint256 soldTokenAmount; // 已经销售总数量
    }
    mapping(address consigneeAddress => ConsigneeInfo) private _consigneeInfos;
    // 记录所有承销商地址
    address[] private _allConsignees;

    // 记录用户从承销商购买的信息
    struct PurchaseInfo {
        address consigneeAddress; // 承销商地址
        uint256 tokenAmount; // 已经购买总数量
        uint256 createTime; // 添加时间
    }
    // 记录用户从承销商购买的信息，一对多
    mapping(address userAddress => PurchaseInfo[]) private _purchaseInfos;
    // 记录承销商对应的用户列表
    mapping(address consigneeAddress => address[] allUsers)
        private _purchasersByConsignee;

    // 事件，记录添加承销商的购买信息
    event AddConsignee(
        address indexed publisher, // 项目方地址
        address indexed consigneeAddress, // 承销商地址
        uint256 tokenAmount // 购买数量
    );

    // 事件，记录添加用户的购买信息
    event AddPurchaseInfo(
        address indexed sender, // 调用者地址，项目方或者承销商
        address indexed consigneeAddress, // 承销商地址
        address indexed userAddress, // 用户地址
        uint256 tokenAmount // 购买数量
    );

    // 修饰符，仅允许注册的承销商调用
    modifier onlyConsignee(address sender) {
        ConsigneeInfo storage info = _consigneeInfos[sender];
        require(
            info.totalTokenAmount > 0,
            "Caller is not a registered consignee"
        );
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address defaultAdmin,
        address pauser,
        address upgrader,
        address operator,
        address _vestingWalletAddress
    ) public initializer {
        __Pausable_init();
        __AccessControl_init();

        vestingWallet = IVestingWallet(_vestingWalletAddress);

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(UPGRADER_ROLE, upgrader);
        _grantRole(OPERATOR_ROLE, operator);
    }

    /**.
     * @dev 添加承销商购买信息，仅项目方可调用。
     * @param _consigneeAddress 承销商地址。
     * @param _tokenAmount 购买数量。
     */
    function addConsignee(
        address _consigneeAddress,
        uint256 _tokenAmount
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused {
        _addConsignee(_consigneeAddress, _tokenAmount);
    }

    function _addConsignee(
        address _consigneeAddress,
        uint256 _tokenAmount
    ) internal {
        require(_consigneeAddress != address(0), "Invalid consignee address");
        require(_tokenAmount > 0, "Invalid token amount");

        ConsigneeInfo storage info = _consigneeInfos[_consigneeAddress];
        info.totalTokenAmount += _tokenAmount;

        _allConsignees.push(_consigneeAddress);

        emit AddConsignee(msg.sender, _consigneeAddress, _tokenAmount);
    }

    /**
     * @dev 批量添加承销商购买信息，仅项目方可调用。
     * @param _consigneeAddresses 承销商地址数组。
     * @param _tokenAmounts 购买数量数组。
     */
    function batchAddConsignee(
        address[] calldata _consigneeAddresses,
        uint256[] calldata _tokenAmounts
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused {
        require(
            _consigneeAddresses.length == _tokenAmounts.length,
            "Mismatched array lengths"
        );

        for (uint256 i = 0; i < _tokenAmounts.length; ) {
            _addConsignee(_consigneeAddresses[i], _tokenAmounts[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev 添加用户购买信息，仅注册的承销商可调用。
     * @param _userAddress 用户地址。
     * @param _tokenAmount 购买数量。
     */
    function consigneeCreateOfflinePurchase(
        address _userAddress,
        uint96 _tokenAmount
    ) external onlyConsignee(msg.sender) whenNotPaused {
        _createOfflinePurchase(msg.sender, _userAddress, _tokenAmount);
    }

    /**
     * @dev 添加用户购买信息，仅项目方可调用。
     * @param _consigneeAddress 承销商地址。
     * @param _userAddress 用户地址。
     * @param _tokenAmount 购买数量。
     */
    function adminCreateOfflinePurchase(
        address _consigneeAddress,
        address _userAddress,
        uint96 _tokenAmount
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused {
        _createOfflinePurchase(_consigneeAddress, _userAddress, _tokenAmount);
    }

    function _createOfflinePurchase(
        address _consigneeAddress,
        address _userAddress,
        uint96 _tokenAmount
    ) internal {
        require(_userAddress != address(0), "Invalid user address");
        require(_tokenAmount > 0, "Invalid token amount");
        ConsigneeInfo storage consigneeInfo = _consigneeInfos[
            _consigneeAddress
        ];
        uint256 tokenAmountLeft = consigneeInfo.totalTokenAmount -
            consigneeInfo.soldTokenAmount;
        require(_tokenAmount <= tokenAmountLeft, "Exceeded total token amount");
        consigneeInfo.soldTokenAmount += _tokenAmount;

        _purchaseInfos[_userAddress].push(
            PurchaseInfo({
                consigneeAddress: _consigneeAddress,
                tokenAmount: _tokenAmount,
                createTime: block.timestamp
            })
        );

        _purchasersByConsignee[_consigneeAddress].push(_userAddress);

        // 与 verstingController 交互
        vestingWallet.addSchedule(_userAddress, _tokenAmount);

        emit AddPurchaseInfo(
            msg.sender,
            _consigneeAddress,
            _userAddress,
            _tokenAmount
        );
    }

    /**
     * @dev 批量添加用户购买信息，仅注册的承销商可调用。
     * @param _userAddresses 用户地址数组。
     * @param _tokenAmounts 购买数量数组。
     */
    function batchConsigneeCreateOfflinePurchase(
        address[] calldata _userAddresses,
        uint96[] calldata _tokenAmounts
    ) external onlyConsignee(msg.sender) whenNotPaused {
        _batchCreateOfflinePurchase(msg.sender, _userAddresses, _tokenAmounts);
    }

    /**
     * @dev 批量添加用户购买信息，仅项目方可调用。
     * @param _consigneeAddress 承销商地址。
     * @param _userAddresses 用户地址数组。
     * @param _tokenAmounts 购买数量数组。
     */
    function batchAdminCreateOfflinePurchase(
        address _consigneeAddress,
        address[] calldata _userAddresses,
        uint96[] calldata _tokenAmounts
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused {
        _batchCreateOfflinePurchase(
            _consigneeAddress,
            _userAddresses,
            _tokenAmounts
        );
    }

    function _batchCreateOfflinePurchase(
        address _consigneeAddress,
        address[] calldata _beneficiaries,
        uint96[] calldata _tokenAmounts
    ) internal {
        require(
            _beneficiaries.length == _tokenAmounts.length,
            "Mismatched array lengths"
        );

        uint256 totalTokenAmount;
        for (uint256 i = 0; i < _tokenAmounts.length; i++) {
            address userAddress = _beneficiaries[i];
            uint256 tokenAmount = _tokenAmounts[i];

            require(userAddress != address(0), "Invalid user address");
            require(tokenAmount > 0, "Invalid token amount");
            totalTokenAmount += tokenAmount;

            _purchaseInfos[userAddress].push(
                PurchaseInfo({
                    consigneeAddress: _consigneeAddress,
                    tokenAmount: tokenAmount,
                    createTime: block.timestamp
                })
            );

            _purchasersByConsignee[_consigneeAddress].push(userAddress);

            emit AddPurchaseInfo(
                msg.sender,
                _consigneeAddress,
                userAddress,
                tokenAmount
            );
        }

        ConsigneeInfo storage consigneeInfo = _consigneeInfos[
            _consigneeAddress
        ];
        uint256 tokenAmountLeft = consigneeInfo.totalTokenAmount -
            consigneeInfo.soldTokenAmount;
        require(
            totalTokenAmount <= tokenAmountLeft,
            "Exceeded total token amount"
        );
        consigneeInfo.soldTokenAmount += totalTokenAmount;

        // 与 vestingWallet 交互
        vestingWallet.battchAddSchedule(_beneficiaries, _tokenAmounts);
    }

    /**
     * @dev 获取承销商的购买信息。
     * @param consigneeAddress 承销商地址。
     * @return 承销商的购买信息。
     */
    function getConsigneeInfo(
        address consigneeAddress
    ) external view returns (ConsigneeInfo memory) {
        return _consigneeInfos[consigneeAddress];
    }

    /**
     * @dev 获取所有承销商的购买信息。
     * @return 承销商信息数组。
     */
    function getAllConsigneeInfo()
        external
        view
        returns (ConsigneeInfo[] memory)
    {
        ConsigneeInfo[] memory infos = new ConsigneeInfo[](
            _allConsignees.length
        );
        for (uint256 i = 0; i < _allConsignees.length; i++) {
            infos[i] = _consigneeInfos[_allConsignees[i]];
        }
        return infos;
    }

    /**
     * @dev 获取所有承销商地址数量。
     * @return 承销商地址数量。
     */
    function getAllConsigneesLength() external view returns (uint256) {
        return _allConsignees.length;
    }

    /**
     * @dev 获取所有承销商地址。
     * @return 承销商地址数组。
     */
    function getAllConsignees() external view returns (address[] memory) {
        return _allConsignees;
    }

    /**
     * @dev 获取用户个人的购买信息。
     * @param userAddress 用户地址。
     * @return 用户的购买信息。
     */
    function getUserPurchaseInfo(
        address userAddress
    ) external view returns (PurchaseInfo[] memory) {
        return _purchaseInfos[userAddress];
    }

    /**
     * @dev 根据承销商地址获取对应的所有用户购买信息。
     * @param consigneeAddress 承销商地址。
     * @return 用户购买信息数组。
     */
    function getUserPurchaseInfoByConsigneeAddress(
        address consigneeAddress
    ) external view returns (PurchaseInfo[] memory) {
        // 获取对应承销商的所有用户地址
        address[] storage purchasers = _purchasersByConsignee[consigneeAddress];
        uint256 length = purchasers.length;
        // 汇总所有用户的购买信息
        PurchaseInfo[] memory purchaseInfosByConsignee = new PurchaseInfo[](
            length
        );
        for (uint256 i = 0; i < length; i++) {
            // 获取用户的购买信息列表，可能包含多个承销商的记录
            PurchaseInfo[] memory purchaseInfos = _purchaseInfos[purchasers[i]];
            for (uint256 j = 0; j < purchaseInfos.length; j++) {
                // 仅筛选出对应承销商的购买信息
                if (purchaseInfos[j].consigneeAddress == consigneeAddress) {
                    purchaseInfosByConsignee[i] = purchaseInfos[j];
                }
            }
        }
        return purchaseInfosByConsignee;
    }

    /**
     * @dev 检查地址是否为注册的承销商。
     * @param consigneeAddress 承销商地址。
     * @return 如果是注册的承销商则返回 true，否则返回 false。
     */
    function isConsignee(
        address consigneeAddress
    ) external view returns (bool) {
        ConsigneeInfo storage info = _consigneeInfos[consigneeAddress];
        return info.totalTokenAmount > 0;
    }

    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(UPGRADER_ROLE) {}
}
