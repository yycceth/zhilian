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
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract VestingWallet is
    Initializable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant VEST_MANAGER_ROLE = keccak256("VEST_MANAGER_ROLE");

    // 归属代币地址
    IERC20 public tokenAddress;

    // 归属计划的自增编号
    uint256 public currentScheduleId;

    // 全局信息
    struct VestingInfo {
        // 悬崖期，按秒
        uint64 cliffTime;
        // 开始时间，按秒
        uint64 startTimestamp;
        // 持续时间，按秒
        uint64 durationTime;
        // tge 时间，按秒
        uint64 tgeTimestamp;
        // tge 时释放的百分比
        uint16 tgePercentage;
    }
    VestingInfo private _vestingInfo;

    struct Schedule {
        // 受益人
        address beneficiary;
        // 代币总数量
        uint96 tokenAmount;
        // tge 释放总数量
        uint96 tgeReleaseAmount;
        // 已领取释放总数量
        uint96 releasedAmount;
        // tge 数量释放已经领取
        bool tgeClaimed;
    }

    // 查询需要
    struct ScheduleInfo {
        // 受益人
        address beneficiary;
        // 代币总数量
        uint256 totalAmount;
        // tge 释放总数量
        uint256 tgeAmount;
        // 已领取释放总数量
        uint256 released;
        // tge 数量释放已经领取
        bool tgeClaimed;
        // 悬崖期，按秒
        uint256 cliff;
        // 开始时间，按秒
        uint256 start;
        // 持续时间，按秒
        uint256 duration;
        // tge 时释放的百分比
        uint16 tgePercentage;
        // derived：依当前时间推导出的动态信息
        // 当前可以释放的总代币数量
        uint256 vested;
        // 当前可以释放的可领取的代币数量
        uint256 claimable;
        // 是否超过了悬崖期
        bool cliffPassed;
    }

    // scheduleId 对应 schedule
    mapping(uint256 scheduleId => Schedule schedule) private _schedules;
    // beneficiary 对应 scheduleIds，多个 schedule
    mapping(address beneficiary => uint256[] scheduleIds)
        private _scheduleIdsOfBeneficiary;

    event AddSchedule(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        uint256 tokenAmount
    );

    event Claim(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        uint256 claimAmount
    );

    event ClaimTgeAmount(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        uint256 tgeAmount
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev 初始化参数
     * @param _defaultAdmin admin 管理员
     * @param _pauser 暂停员
     * @param _upgrader 更新员
     * @param _manager 添加归属管理员
     * @param _tokenAddress 释放代币地址
     */
    function initialize(
        address _defaultAdmin,
        address _pauser,
        address _upgrader,
        address _manager,
        address _tokenAddress
    ) public initializer {
        __Pausable_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _defaultAdmin);
        _grantRole(PAUSER_ROLE, _pauser);
        _grantRole(UPGRADER_ROLE, _upgrader);
        _grantRole(VEST_MANAGER_ROLE, _manager);

        tokenAddress = IERC20(_tokenAddress);
    }

    /**
     * @dev 管理员更新 VestingInfo
     * @param _cliffTime 悬崖期时间，秒
     * @param _startTimestamp 开始时间戳
     * @param _durationTime 持续时间
     * @param _tgeTimestamp tge 时间戳
     * @param _tgePercentage tge 释放百分比
     */
    function updateVestingInfo(
        uint64 _cliffTime,
        uint64 _startTimestamp,
        uint64 _durationTime,
        uint64 _tgeTimestamp,
        uint16 _tgePercentage
    ) external onlyRole(VEST_MANAGER_ROLE) {
        _vestingInfo = VestingInfo({
            cliffTime: _cliffTime,
            startTimestamp: _startTimestamp,
            durationTime: _durationTime,
            tgeTimestamp: _tgeTimestamp,
            tgePercentage: _tgePercentage
        });
    }

    /**
     * @dev 管理员添加归属计划
     * @param _beneficiary 受益人地址
     * @param _tokenAmount 代币数量
     * return scheduleId 返回当前的 scheduleId
     */
    function addSchedule(
        address _beneficiary,
        uint96 _tokenAmount
    )
        external
        onlyRole(VEST_MANAGER_ROLE)
        whenNotPaused
        returns (uint256 scheduleId)
    {
        return _addSchedule(_beneficiary, _tokenAmount);
    }

    /**
     * @dev 管理员批量添加归属计划
     * @param _beneficiaries 受益人地址数组
     * @param _tokenAmounts 代币数量数组
     */
    function battchAddSchedule(
        address[] calldata _beneficiaries,
        uint96[] calldata _tokenAmounts
    ) external onlyRole(VEST_MANAGER_ROLE) whenNotPaused {
        require(
            _beneficiaries.length == _tokenAmounts.length,
            "Mismatched array length"
        );
        for (uint256 i = 0; i < _tokenAmounts.length; ) {
            _addSchedule(_beneficiaries[i], _tokenAmounts[i]);
            unchecked {
                ++i;
            }
        }
    }

    function _addSchedule(
        address _beneficiary,
        uint96 _tokenAmount
    ) internal returns (uint256 scheduleId) {
        require(_beneficiary != address(0), "Beneficiary address is zero");
        require(_tokenAmount != 0, "Token amount is zero");
        require(
            block.timestamp < _vestingInfo.tgeTimestamp,
            "Current time is greater than tge time"
        );

        // 先自增
        ++currentScheduleId;

        scheduleId = currentScheduleId;

        // 保存最新 scheduleId 对应 schedule
        _schedules[scheduleId] = Schedule({
            // 受益人
            beneficiary: _beneficiary,
            // 代币总数量
            tokenAmount: _tokenAmount,
            // tge 释放总数量
            tgeReleaseAmount: (_tokenAmount * _vestingInfo.tgePercentage) /
                10000,
            // 已释放总数量
            releasedAmount: 0,
            // tge 数量是否已经领取
            tgeClaimed: false
        });
        // 保存 beneficiary 对应 scheduleIds
        _scheduleIdsOfBeneficiary[_beneficiary].push(scheduleId);

        emit AddSchedule(scheduleId, _beneficiary, _tokenAmount);
    }

    /**
     * @dev 用户领取tge的代币数量
     * @param _scheduleId _scheduleId
     * @return tgeAmount tgeAmount 数量
     */
    function claimTgeAmount(
        uint256 _scheduleId
    ) external whenNotPaused returns (uint96 tgeAmount) {
        return _claimTgeAmount(_scheduleId, msg.sender);
    }

    /**
     * @dev 用户批量领取tge的代币数量
     * @param _scheduleIds _scheduleId 数组
     * @return tgeAllAmount tgeAllAmount 总数量
     */
    function batchClaimTgeAmount(
        uint256[] calldata _scheduleIds
    ) external whenNotPaused returns (uint96 tgeAllAmount) {
        for (uint256 i = 0; i < _scheduleIds.length; ) {
            uint96 tgeAmount = _schedules[_scheduleIds[i]].tgeReleaseAmount;
            require(tgeAmount > 0, "Invalid schedule id");
            require(
                _schedules[_scheduleIds[i]].beneficiary == msg.sender,
                "Sender should be beneficiary"
            );
            require(
                block.timestamp >= _vestingInfo.tgeTimestamp,
                "Invalid tge timestamp"
            );
            require(!_schedules[_scheduleIds[i]].tgeClaimed, "Already claimed");
            _schedules[_scheduleIds[i]].tgeClaimed = true;

            tgeAllAmount += tgeAmount;
            emit ClaimTgeAmount(_scheduleIds[i], msg.sender, tgeAmount);

            unchecked {
                ++i;
            }
        }

        tokenAddress.safeTransfer(msg.sender, tgeAllAmount);
    }

    /**
     * @dev 管理员批量领取tge的代币数量
     * @param _scheduleIds _scheduleId 数组
     */
    function adminBatchClaimTgeAmount(
        uint256[] calldata _scheduleIds
    ) external onlyRole(VEST_MANAGER_ROLE) whenNotPaused {
        for (uint256 i = 0; i < _scheduleIds.length; ) {
            _claimTgeAmount(
                _scheduleIds[i],
                _schedules[_scheduleIds[i]].beneficiary
            );
            unchecked {
                ++i;
            }
        }
    }

    function _claimTgeAmount(
        uint256 _scheduleId,
        address _beneficiary
    ) internal returns (uint96 tgeAmount) {
        tgeAmount = _schedules[_scheduleId].tgeReleaseAmount;
        require(tgeAmount > 0, "Invalid schedule id");
        require(
            _schedules[_scheduleId].beneficiary == _beneficiary,
            "Sender should be beneficiary"
        );
        require(
            block.timestamp >= _vestingInfo.tgeTimestamp,
            "Invalid tge timestamp"
        );
        require(!_schedules[_scheduleId].tgeClaimed, "Already claimed");
        _schedules[_scheduleId].tgeClaimed = true;
        tokenAddress.safeTransfer(_beneficiary, tgeAmount);
        emit ClaimTgeAmount(_scheduleId, _beneficiary, tgeAmount);
    }

    /**
     * @dev 用户领取释放的代币数量
     * @param _scheduleId _scheduleId
     * @return claimableAmount 可领取的总数量
     */
    function claim(
        uint256 _scheduleId
    ) public whenNotPaused returns (uint96 claimableAmount) {
        return _claim(_scheduleId, msg.sender);
    }

    /**
     * @dev 用户批量领取代币数量
     * @param _scheduleIds _scheduleId 数组
     * @return claimableAmount 可领取的总数量
     */
    function batchClaim(
        uint256[] calldata _scheduleIds
    ) external whenNotPaused returns (uint96 claimableAmount) {
        for (uint256 i = 0; i < _scheduleIds.length; ) {
            require(
                _schedules[_scheduleIds[i]].tokenAmount > 0,
                "Invalid schedule id"
            );
            require(
                _schedules[_scheduleIds[i]].beneficiary == msg.sender,
                "Sender should be beneficiary"
            );

            uint96 currentIdclaimableAmount = getClaimableAmountByScheduleId(
                _scheduleIds[i]
            );
            require(currentIdclaimableAmount > 0, "Claimable amount is zero");

            _schedules[_scheduleIds[i]]
                .releasedAmount += currentIdclaimableAmount;

            claimableAmount += currentIdclaimableAmount;

            emit Claim(_scheduleIds[i], msg.sender, currentIdclaimableAmount);

            unchecked {
                ++i;
            }
        }

        tokenAddress.safeTransfer(msg.sender, claimableAmount);
    }

    /**
     * @dev 管理员批量领取代币数量
     * @param _scheduleIds _scheduleId 数组
     */
    function adminBatchClaim(
        uint256[] calldata _scheduleIds
    ) external onlyRole(VEST_MANAGER_ROLE) whenNotPaused {
        for (uint256 i = 0; i < _scheduleIds.length; ) {
            _claim(_scheduleIds[i], _schedules[_scheduleIds[i]].beneficiary);
            unchecked {
                ++i;
            }
        }
    }

    function _claim(
        uint256 _scheduleId,
        address _beneficiary
    ) internal returns (uint96 claimableAmount) {
        require(_schedules[_scheduleId].tokenAmount > 0, "Invalid schedule id");
        require(
            _schedules[_scheduleId].beneficiary == _beneficiary,
            "Sender should be beneficiary"
        );

        // 获取可领取的代币数量
        claimableAmount = getClaimableAmountByScheduleId(_scheduleId);
        require(claimableAmount > 0, "Claimable amount is zero");

        _schedules[_scheduleId].releasedAmount += claimableAmount;

        tokenAddress.safeTransfer(_beneficiary, claimableAmount);

        emit Claim(_scheduleId, _beneficiary, claimableAmount);
    }

    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @dev 获取用户对应的所有 scheduleIds
     * @param _beneficiary 受益人地址
     * @return 用户对应的所有 scheduleIds
     */
    function getScheduleIdsOfBeneficiary(
        address _beneficiary
    ) external view returns (uint256[] memory) {
        return _scheduleIdsOfBeneficiary[_beneficiary];
    }

    /**
     * @dev 根据 scheduleId 获取 ScheduleInfo
     * @param _scheduleId scheduleId
     * @return scheduleInfo 获取 ScheduleInfo
     */
    function getScheduleInfoById(
        uint256 _scheduleId
    ) external view returns (ScheduleInfo memory scheduleInfo) {
        Schedule storage schedule = _schedules[_scheduleId];

        // 根据 scheduleId 获取当前总释放的代币数量
        uint96 allReleaseAmount = getAllVestedAmount(
            _scheduleId,
            uint64(block.timestamp)
        );
        // 已释放总数量
        uint96 released = schedule.releasedAmount;

        // 计算 tge 是否可以领取了
        uint96 tgeAmount;
        if (block.timestamp >= _vestingInfo.tgeTimestamp) {
            tgeAmount = schedule.tgeReleaseAmount;
        }

        scheduleInfo = ScheduleInfo({
            beneficiary: schedule.beneficiary,
            totalAmount: schedule.tokenAmount,
            tgeAmount: tgeAmount,
            released: released,
            tgeClaimed: schedule.tgeClaimed,
            start: _vestingInfo.startTimestamp,
            cliff: _vestingInfo.cliffTime,
            duration: _vestingInfo.durationTime,
            tgePercentage: _vestingInfo.tgePercentage,
            vested: allReleaseAmount,
            claimable: allReleaseAmount - released,
            cliffPassed: block.timestamp >=
                _vestingInfo.startTimestamp + _vestingInfo.cliffTime
        });
    }

    /**
     * @dev 根据 scheduleId 获取当前可以释放的代币数量
     * @param _scheduleId scheduleId
     * @return claimableAmount 可以释放的代币数量
     */
    function getClaimableAmountByScheduleId(
        uint256 _scheduleId
    ) public view returns (uint96 claimableAmount) {
        return
            getAllVestedAmount(_scheduleId, uint64(block.timestamp)) -
            _schedules[_scheduleId].releasedAmount;
    }

    /**
     * @dev 根据 scheduleId 获取当前总释放的代币数量
     * @param _scheduleId scheduleId
     * @param _currentTimestamp 给定的时间戳
     * @return 可以释放的总代币数量
     */
    function getAllVestedAmount(
        uint256 _scheduleId,
        uint64 _currentTimestamp
    ) public view returns (uint96) {
        return
            _vestingSchedule(
                _schedules[_scheduleId].tokenAmount,
                _currentTimestamp
            );
    }

    function endTime() public view returns (uint256) {
        return
            _vestingInfo.startTimestamp +
            _vestingInfo.cliffTime +
            _vestingInfo.durationTime;
    }

    /**
     * @dev 获取全局数据
     * @return 获取全局数据
     */
    function getVestingInfo() external view returns (VestingInfo memory) {
        return _vestingInfo;
    }

    function _vestingSchedule(
        uint96 totalAllocation,
        uint64 timestamp
    ) internal view returns (uint96) {
        // 还没有到开始时间
        if (timestamp < _vestingInfo.startTimestamp + _vestingInfo.cliffTime) {
            return 0;
            // 已到结束时间
        } else if (timestamp > endTime()) {
            return totalAllocation;
        } else {
            // 中间时间段
            return
                (totalAllocation *
                    (timestamp -
                        (_vestingInfo.startTimestamp +
                            _vestingInfo.cliffTime))) /
                _vestingInfo.durationTime;
        }
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(UPGRADER_ROLE) {}
}
