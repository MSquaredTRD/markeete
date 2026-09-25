// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title DeliveryEscrow
/// @notice Immutable, single-token marketplace escrow for a buyer, seller and courier.
/// @dev Physical-world facts are represented only by role transactions and deterministic timeouts.
contract DeliveryEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_COURIER_PENALTY_BPS = 5_000;
    uint256 public constant MAX_ORDER_HORIZON = 365 days;
    uint128 public constant COURIER_OFFER_FEE = 0.05e6;
    uint64 public constant COURIER_SELECTION_PERIOD = 3 days;
    uint64 public constant COURIER_FUNDING_PERIOD = 1 days;
    uint64 public constant SELLER_FUNDING_PERIOD = 1 days;
    uint64 public constant MAX_RETURN_MATCHING_PERIOD = 30 days;

    enum ProductStatus {
        None,
        Active,
        Reserved,
        Inactive,
        Sold,
        Lost
    }

    enum OrderState {
        None,
        AwaitingCourier,
        AwaitingCourierBond,
        AwaitingSellerBond,
        ReadyForPickup,
        InTransit,
        Delivered,
        ReturnRequested,
        AwaitingReturnCourierBond,
        ReturnCourierAccepted,
        ReturnInTransit,
        Completed,
        Cancelled,
        Refunded,
        CourierDefaulted
    }

    enum DeliveryMode {
        HandToHand,
        BuyerAuthorizedSafeDrop
    }

    enum ReturnReason {
        None,
        BuyerChoice,
        SellerFault,
        BuyerAbsent
    }

    struct Product {
        address seller;
        uint128 price;
        bytes32 metadataHash;
        ProductStatus status;
    }

    struct CourierOffer {
        uint64 pickupPeriod;
        uint64 deliveryPeriod;
        bool active;
    }

    struct Order {
        uint256 productId;
        address seller;
        address buyer;
        address courier;
        address returnCourier;
        uint128 price;
        uint128 forwardDeliveryFee;
        uint128 returnDeliveryFee;
        uint128 buyerEscrow;
        uint128 sellerBond;
        uint128 courierBond;
        uint128 returnCourierBond;
        uint64 courierAcceptDeadline;
        uint64 courierFundingDeadline;
        uint64 sellerFundingDeadline;
        uint64 pickupDeadline;
        uint64 deliveryDeadline;
        uint64 selectedPickupPeriod;
        uint64 selectedDeliveryPeriod;
        uint64 deliveredAt;
        uint64 inspectionEndsAt;
        uint64 absentReportedAt;
        uint64 returnAcceptDeadline;
        uint64 returnProcessDeadline;
        uint64 returnCourierFundingDeadline;
        uint64 returnPickupDeadline;
        uint64 returnDeliveryDeadline;
        uint8 pickupConfirmations;
        uint8 deliveryConfirmations;
        uint8 mismatchConfirmations;
        uint8 returnPickupConfirmations;
        uint8 returnDeliveryConfirmations;
        OrderState state;
        DeliveryMode deliveryMode;
        ReturnReason returnReason;
    }

    error ZeroAddress();
    error InvalidAmount();
    error InvalidConfiguration();
    error InvalidDeadline();
    error InvalidState(OrderState expected, OrderState actual);
    error Unauthorized();
    error NewActivityPaused();
    error AlreadyConfirmed();
    error ConflictingConfirmation();
    error DeadlinePassed();
    error DeadlineNotReached();
    error NothingToClaim();
    error UnsupportedTransferBehavior();
    error Insolvent();
    error CourierAlreadyReportedDelivery();
    error OfferNotFound();

    event ProductListed(
        uint256 indexed productId,
        address indexed seller,
        uint256 price,
        bytes32 indexed metadataHash
    );
    event ProductUpdated(uint256 indexed productId, uint256 price, bytes32 metadataHash);
    event ProductStatusChanged(uint256 indexed productId, ProductStatus status);
    event OrderCreated(
        uint256 indexed orderId,
        uint256 indexed productId,
        address indexed buyer,
        uint256 buyerEscrow,
        DeliveryMode deliveryMode
    );
    event OrderStateChanged(uint256 indexed orderId, OrderState state);
    event CourierAccepted(uint256 indexed orderId, address indexed courier, uint256 bond);
    event CourierOfferSubmitted(
        uint256 indexed orderId,
        address indexed courier,
        uint256 pickupPeriod,
        uint256 deliveryPeriod
    );
    event CourierApproved(uint256 indexed orderId, address indexed courier);
    event SellerBondFunded(uint256 indexed orderId, uint256 bond);
    event RoleConfirmed(uint256 indexed orderId, bytes32 indexed action, address indexed role);
    event BuyerAbsentReported(uint256 indexed orderId, uint256 reportedAt);
    event ReturnCourierAccepted(uint256 indexed orderId, address indexed courier, uint256 bond);
    event ReturnCourierOfferSubmitted(uint256 indexed orderId, address indexed courier);
    event ReturnCourierApproved(uint256 indexed orderId, address indexed courier);
    event CourierSelectionReset(uint256 indexed orderId, address indexed courier);
    event ReturnCourierSelectionReset(uint256 indexed orderId, address indexed courier);
    event FundsCredited(uint256 indexed orderId, address indexed account, uint256 amount);
    event Claimed(address indexed account, uint256 grossAmount, uint256 fee, uint256 netAmount);
    event FeeCollected(address indexed payer, uint256 amount, bytes32 indexed feeType);
    event FeesWithdrawn(address indexed recipient, uint256 amount);
    event NewActivityPauseChanged(bool paused);

    bytes32 private constant ACTION_PICKUP = keccak256("PICKUP");
    bytes32 private constant ACTION_DELIVERY = keccak256("DELIVERY");
    bytes32 private constant ACTION_MISMATCH = keccak256("MISMATCH");
    bytes32 private constant ACTION_RETURN_PICKUP = keccak256("RETURN_PICKUP");
    bytes32 private constant ACTION_RETURN_DELIVERY = keccak256("RETURN_DELIVERY");

    uint8 private constant CONFIRMATION_FIRST_ROLE = 1;
    uint8 private constant CONFIRMATION_SECOND_ROLE = 2;
    uint8 private constant CONFIRMATION_COMPLETE = 3;

    IERC20 public immutable paymentToken;
    address public immutable treasury;
    address public immutable guardian;

    uint128 public immutable listingFee;
    uint128 public immutable purchaseFee;
    uint128 public immutable actionFee;
    uint16 public immutable courierPenaltyBps;

    uint64 public immutable inspectionPeriod;
    uint64 public immutable buyerAbsentGracePeriod;
    uint64 public immutable returnAcceptPeriod;
    uint64 public immutable returnPickupPeriod;
    uint64 public immutable returnDeliveryPeriod;

    uint256 public nextProductId = 1;
    uint256 public nextOrderId = 1;
    uint256 public totalLiability;
    uint256 public accruedFees;
    bool public newActivityPaused;

    mapping(uint256 productId => Product) private _products;
    mapping(uint256 orderId => Order) private _orders;
    mapping(uint256 orderId => mapping(address courier => CourierOffer)) private _courierOffers;
    mapping(uint256 orderId => mapping(address courier => bool)) private _returnCourierOffers;
    mapping(address account => uint256 amount) public claimable;

    constructor(
        IERC20 paymentToken_,
        address treasury_,
        address guardian_,
        uint128 listingFee_,
        uint128 purchaseFee_,
        uint128 actionFee_,
        uint16 courierPenaltyBps_,
        uint64 inspectionPeriod_,
        uint64 buyerAbsentGracePeriod_,
        uint64 returnAcceptPeriod_,
        uint64 returnPickupPeriod_,
        uint64 returnDeliveryPeriod_
    ) {
        if (
            address(paymentToken_) == address(0) || treasury_ == address(0)
                || guardian_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (treasury_ == address(this) || guardian_ == address(this)) {
            revert InvalidConfiguration();
        }
        if (IERC20Metadata(address(paymentToken_)).decimals() != 6) {
            revert InvalidConfiguration();
        }
        if (
            courierPenaltyBps_ > MAX_COURIER_PENALTY_BPS || inspectionPeriod_ == 0
                || buyerAbsentGracePeriod_ == 0 || returnAcceptPeriod_ == 0
                || returnPickupPeriod_ == 0 || returnDeliveryPeriod_ == 0
                || inspectionPeriod_ > MAX_ORDER_HORIZON
                || buyerAbsentGracePeriod_ > MAX_ORDER_HORIZON
                || returnAcceptPeriod_ > MAX_ORDER_HORIZON
                || returnPickupPeriod_ > MAX_ORDER_HORIZON
                || returnDeliveryPeriod_ > MAX_ORDER_HORIZON
        ) revert InvalidConfiguration();

        paymentToken = paymentToken_;
        treasury = treasury_;
        guardian = guardian_;
        listingFee = listingFee_;
        purchaseFee = purchaseFee_;
        actionFee = actionFee_;
        courierPenaltyBps = courierPenaltyBps_;
        inspectionPeriod = inspectionPeriod_;
        buyerAbsentGracePeriod = buyerAbsentGracePeriod_;
        returnAcceptPeriod = returnAcceptPeriod_;
        returnPickupPeriod = returnPickupPeriod_;
        returnDeliveryPeriod = returnDeliveryPeriod_;
    }

    modifier onlyGuardian() {
        _checkGuardian();
        _;
    }

    modifier whenNewActivityAllowed() {
        _checkNewActivityAllowed();
        _;
    }

    function _checkGuardian() private view {
        if (msg.sender != guardian) revert Unauthorized();
    }

    function _checkNewActivityAllowed() private view {
        if (newActivityPaused) revert NewActivityPaused();
    }

    function getProduct(uint256 productId) external view returns (Product memory) {
        return _products[productId];
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return _orders[orderId];
    }

    function getCourierOffer(uint256 orderId, address courier)
        external
        view
        returns (CourierOffer memory)
    {
        return _courierOffers[orderId][courier];
    }

    function hasReturnCourierOffer(uint256 orderId, address courier) external view returns (bool) {
        return _returnCourierOffers[orderId][courier];
    }

    function requiredCourierBond(uint256 price) public view returns (uint256) {
        return price + Math.mulDiv(price, courierPenaltyBps, BPS_DENOMINATOR, Math.Rounding.Ceil);
    }

    function orderLiability(uint256 orderId) external view returns (uint256) {
        Order storage order = _orders[orderId];
        return
            uint256(order.buyerEscrow) + order.sellerBond + order.courierBond
                + order.returnCourierBond;
    }

    function accountingInvariantHolds() external view returns (bool) {
        return paymentToken.balanceOf(address(this)) >= totalLiability + accruedFees;
    }

    function setNewActivityPaused(bool paused) external onlyGuardian {
        newActivityPaused = paused;
        emit NewActivityPauseChanged(paused);
    }

    function withdrawFees(address recipient, uint256 amount) external nonReentrant {
        if (msg.sender != treasury) revert Unauthorized();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0 || amount > accruedFees) revert InvalidAmount();

        accruedFees -= amount;
        paymentToken.safeTransfer(recipient, amount);
        if (paymentToken.balanceOf(address(this)) < totalLiability + accruedFees) {
            revert Insolvent();
        }
        emit FeesWithdrawn(recipient, amount);
    }

    function listProduct(uint128 price, bytes32 metadataHash)
        external
        nonReentrant
        whenNewActivityAllowed
        returns (uint256 productId)
    {
        if (price == 0 || metadataHash == bytes32(0)) {
            revert InvalidAmount();
        }
        _collectFee(msg.sender, listingFee, keccak256("LISTING"));

        productId = nextProductId++;
        _products[productId] = Product({
            seller: msg.sender,
            price: price,
            metadataHash: metadataHash,
            status: ProductStatus.Active
        });
        emit ProductListed(productId, msg.sender, price, metadataHash);
    }

    function updateProduct(uint256 productId, uint128 price, bytes32 metadataHash)
        external
        nonReentrant
        whenNewActivityAllowed
    {
        Product storage product = _products[productId];
        if (product.seller != msg.sender) revert Unauthorized();
        if (product.status != ProductStatus.Active) revert InvalidConfiguration();
        if (price == 0 || metadataHash == bytes32(0)) {
            revert InvalidAmount();
        }
        _collectActionFee(msg.sender);

        product.price = price;
        product.metadataHash = metadataHash;
        emit ProductUpdated(productId, price, metadataHash);
    }

    function deactivateProduct(uint256 productId) external nonReentrant {
        Product storage product = _products[productId];
        if (product.seller != msg.sender) revert Unauthorized();
        if (product.status != ProductStatus.Active) revert InvalidConfiguration();
        _collectActionFee(msg.sender);

        product.status = ProductStatus.Inactive;
        emit ProductStatusChanged(productId, ProductStatus.Inactive);
    }

    function reactivateProduct(uint256 productId) external nonReentrant whenNewActivityAllowed {
        Product storage product = _products[productId];
        if (product.seller != msg.sender) revert Unauthorized();
        if (product.status != ProductStatus.Inactive) revert InvalidConfiguration();
        _collectActionFee(msg.sender);

        product.status = ProductStatus.Active;
        emit ProductStatusChanged(productId, ProductStatus.Active);
    }

    function createOrder(
        uint256 productId,
        uint128 forwardDeliveryFee,
        uint128 returnDeliveryFee,
        DeliveryMode deliveryMode
    ) external nonReentrant whenNewActivityAllowed returns (uint256 orderId) {
        Product storage product = _products[productId];
        if (product.status != ProductStatus.Active) revert InvalidConfiguration();
        if (product.seller == msg.sender) revert Unauthorized();
        if (forwardDeliveryFee == 0 || returnDeliveryFee == 0) revert InvalidAmount();

        uint256 escrow = uint256(product.price) + forwardDeliveryFee + returnDeliveryFee;
        if (escrow > type(uint128).max) revert InvalidAmount();
        _pullPrincipalAndFee(msg.sender, escrow, purchaseFee, keccak256("PURCHASE"));

        product.status = ProductStatus.Reserved;
        emit ProductStatusChanged(productId, ProductStatus.Reserved);

        orderId = nextOrderId++;
        Order storage order = _orders[orderId];
        order.productId = productId;
        order.seller = product.seller;
        order.buyer = msg.sender;
        order.price = product.price;
        order.forwardDeliveryFee = forwardDeliveryFee;
        order.returnDeliveryFee = returnDeliveryFee;
        order.buyerEscrow = escrow.toUint128();
        order.courierAcceptDeadline = _futureTimestamp(COURIER_SELECTION_PERIOD);
        order.state = OrderState.AwaitingCourier;
        order.deliveryMode = deliveryMode;

        emit OrderCreated(orderId, productId, msg.sender, escrow, deliveryMode);
        emit OrderStateChanged(orderId, OrderState.AwaitingCourier);
    }

    function cancelUnmatchedOrder(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.AwaitingCourier);
        if (msg.sender != order.buyer) revert Unauthorized();
        _collectActionFee(msg.sender);
        _cancelBeforeCustody(orderId, order);
    }

    /// @notice Submits a delivery proposal. No bond is locked until the seller approves it.
    function acceptCourier(uint256 orderId, uint64 pickupPeriod, uint64 deliveryPeriod)
        external
        nonReentrant
    {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.AwaitingCourier);
        if (block.timestamp > order.courierAcceptDeadline) revert DeadlinePassed();
        if (msg.sender == order.buyer || msg.sender == order.seller) revert Unauthorized();
        if (
            pickupPeriod == 0 || deliveryPeriod == 0 || pickupPeriod > MAX_ORDER_HORIZON
                || deliveryPeriod > MAX_ORDER_HORIZON
        ) revert InvalidDeadline();

        _collectCourierOfferFee(msg.sender);
        _courierOffers[orderId][msg.sender] = CourierOffer({
            pickupPeriod: pickupPeriod, deliveryPeriod: deliveryPeriod, active: true
        });
        emit CourierOfferSubmitted(orderId, msg.sender, pickupPeriod, deliveryPeriod);
    }

    /// @notice Selects one courier proposal. Only the product seller can make the selection.
    function approveCourier(uint256 orderId, address courier_) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.AwaitingCourier);
        if (msg.sender != order.seller) revert Unauthorized();
        if (block.timestamp > order.courierAcceptDeadline) revert DeadlinePassed();

        CourierOffer storage offer = _courierOffers[orderId][courier_];
        if (!offer.active) revert OfferNotFound();

        offer.active = false;
        order.courier = courier_;
        order.selectedPickupPeriod = offer.pickupPeriod;
        order.selectedDeliveryPeriod = offer.deliveryPeriod;
        order.courierFundingDeadline = _futureTimestamp(COURIER_FUNDING_PERIOD);
        order.state = OrderState.AwaitingCourierBond;
        emit CourierApproved(orderId, courier_);
        emit OrderStateChanged(orderId, OrderState.AwaitingCourierBond);
    }

    /// @notice Locks the selected courier's product-value bond after seller approval.
    function fundCourierBond(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.AwaitingCourierBond);
        if (msg.sender != order.courier) revert Unauthorized();
        if (block.timestamp > order.courierFundingDeadline) revert DeadlinePassed();

        uint256 bond = requiredCourierBond(order.price);
        if (bond > type(uint128).max) revert InvalidAmount();
        _pullPrincipalAndActionFee(msg.sender, bond);

        order.courier = msg.sender;
        order.courierBond = bond.toUint128();
        order.sellerFundingDeadline = _futureTimestamp(SELLER_FUNDING_PERIOD);
        order.state = OrderState.AwaitingSellerBond;
        emit CourierAccepted(orderId, msg.sender, bond);
        emit OrderStateChanged(orderId, OrderState.AwaitingSellerBond);
    }

    function fundSellerBond(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.AwaitingSellerBond);
        if (msg.sender != order.seller) revert Unauthorized();
        if (block.timestamp > order.sellerFundingDeadline) revert DeadlinePassed();

        uint256 bond = uint256(order.forwardDeliveryFee) + order.returnDeliveryFee;
        if (bond > type(uint128).max) revert InvalidAmount();
        _pullPrincipalAndActionFee(msg.sender, bond);

        order.sellerBond = bond.toUint128();
        order.pickupDeadline = _futureTimestamp(order.selectedPickupPeriod);
        order.state = OrderState.ReadyForPickup;
        emit SellerBondFunded(orderId, bond);
        emit OrderStateChanged(orderId, OrderState.ReadyForPickup);
    }

    function confirmPickup(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.ReadyForPickup);
        if (block.timestamp > order.pickupDeadline) revert DeadlinePassed();

        uint8 roleBit = 0;
        if (msg.sender == order.seller) roleBit = CONFIRMATION_FIRST_ROLE;
        else if (msg.sender == order.courier) roleBit = CONFIRMATION_SECOND_ROLE;
        else revert Unauthorized();

        order.pickupConfirmations = _recordConfirmation(order.pickupConfirmations, roleBit);
        _collectActionFee(msg.sender);
        emit RoleConfirmed(orderId, ACTION_PICKUP, msg.sender);

        if (order.pickupConfirmations == CONFIRMATION_COMPLETE) {
            order.deliveryDeadline = _futureTimestamp(order.selectedDeliveryPeriod);
            order.state = OrderState.InTransit;
            emit OrderStateChanged(orderId, OrderState.InTransit);
        }
    }

    function confirmDelivery(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.InTransit);
        if (block.timestamp > _deliveryConfirmationCutoff(order)) revert DeadlinePassed();

        uint8 roleBit = 0;
        if (msg.sender == order.buyer) roleBit = CONFIRMATION_FIRST_ROLE;
        else if (msg.sender == order.courier) roleBit = CONFIRMATION_SECOND_ROLE;
        else revert Unauthorized();
        if ((order.mismatchConfirmations & roleBit) != 0) revert ConflictingConfirmation();

        order.deliveryConfirmations = _recordConfirmation(order.deliveryConfirmations, roleBit);
        _collectActionFee(msg.sender);
        emit RoleConfirmed(orderId, ACTION_DELIVERY, msg.sender);

        if (order.deliveryConfirmations == CONFIRMATION_COMPLETE) {
            _markDelivered(orderId, order);
        }
    }

    function confirmSafeDrop(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.InTransit);
        if (order.deliveryMode != DeliveryMode.BuyerAuthorizedSafeDrop) {
            revert InvalidConfiguration();
        }
        if (msg.sender != order.courier) revert Unauthorized();
        if (block.timestamp > order.deliveryDeadline) revert DeadlinePassed();
        if (order.mismatchConfirmations != 0) {
            revert ConflictingConfirmation();
        }

        _collectActionFee(msg.sender);
        emit RoleConfirmed(orderId, ACTION_DELIVERY, msg.sender);
        _markDelivered(orderId, order);
    }

    function confirmMismatch(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.InTransit);
        if (block.timestamp > _deliveryConfirmationCutoff(order)) revert DeadlinePassed();

        uint8 roleBit = 0;
        if (msg.sender == order.buyer) roleBit = CONFIRMATION_FIRST_ROLE;
        else if (msg.sender == order.courier) roleBit = CONFIRMATION_SECOND_ROLE;
        else revert Unauthorized();
        if ((order.deliveryConfirmations & roleBit) != 0) revert ConflictingConfirmation();

        order.mismatchConfirmations = _recordConfirmation(order.mismatchConfirmations, roleBit);
        _collectActionFee(msg.sender);
        emit RoleConfirmed(orderId, ACTION_MISMATCH, msg.sender);

        if (order.mismatchConfirmations == CONFIRMATION_COMPLETE) {
            order.returnCourier = order.courier;
            order.returnReason = ReturnReason.SellerFault;
            order.returnDeliveryDeadline = _futureTimestamp(returnDeliveryPeriod);
            order.state = OrderState.ReturnInTransit;
            emit OrderStateChanged(orderId, OrderState.ReturnInTransit);
        }
    }

    function reportBuyerAbsent(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.InTransit);
        if (msg.sender != order.courier) revert Unauthorized();
        if (order.absentReportedAt != 0) revert AlreadyConfirmed();
        if (block.timestamp < order.deliveryDeadline) revert DeadlineNotReached();
        if (block.timestamp > uint256(order.deliveryDeadline) + buyerAbsentGracePeriod) {
            revert DeadlinePassed();
        }

        _collectActionFee(msg.sender);
        order.absentReportedAt = uint64(block.timestamp);
        emit BuyerAbsentReported(orderId, block.timestamp);
    }

    function beginBuyerAbsentReturn(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.InTransit);
        if (msg.sender != order.courier) revert Unauthorized();
        if (order.absentReportedAt == 0) revert InvalidConfiguration();
        if (block.timestamp < uint256(order.absentReportedAt) + buyerAbsentGracePeriod) {
            revert DeadlineNotReached();
        }

        _collectActionFee(msg.sender);
        order.returnCourier = order.courier;
        order.returnReason = ReturnReason.BuyerAbsent;
        order.returnDeliveryDeadline = _futureTimestamp(returnDeliveryPeriod);
        order.state = OrderState.ReturnInTransit;
        emit OrderStateChanged(orderId, OrderState.ReturnInTransit);
    }

    function requestReturn(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.Delivered);
        if (msg.sender != order.buyer) revert Unauthorized();
        if (block.timestamp > order.inspectionEndsAt) revert DeadlinePassed();

        _collectActionFee(msg.sender);
        order.returnReason = ReturnReason.BuyerChoice;
        order.returnAcceptDeadline = _futureTimestamp(returnAcceptPeriod);
        order.returnProcessDeadline = _futureTimestamp(MAX_RETURN_MATCHING_PERIOD);
        order.state = OrderState.ReturnRequested;
        emit OrderStateChanged(orderId, OrderState.ReturnRequested);
    }

    /// @notice Submits a proposal to carry a voluntary return. The buyer selects the courier.
    function acceptReturnCourier(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.ReturnRequested);
        if (block.timestamp > order.returnAcceptDeadline) revert DeadlinePassed();
        if (msg.sender == order.buyer || msg.sender == order.seller) revert Unauthorized();

        _collectCourierOfferFee(msg.sender);
        _returnCourierOffers[orderId][msg.sender] = true;
        emit ReturnCourierOfferSubmitted(orderId, msg.sender);
    }

    /// @notice Selects a return-courier proposal. Only the buyer handing over the item can select.
    function approveReturnCourier(uint256 orderId, address courier_) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.ReturnRequested);
        if (msg.sender != order.buyer) revert Unauthorized();
        if (block.timestamp > order.returnAcceptDeadline) revert DeadlinePassed();
        if (!_returnCourierOffers[orderId][courier_]) revert OfferNotFound();

        _returnCourierOffers[orderId][courier_] = false;
        order.returnCourier = courier_;
        order.returnCourierFundingDeadline = _futureTimestamp(COURIER_FUNDING_PERIOD);
        order.state = OrderState.AwaitingReturnCourierBond;
        emit ReturnCourierApproved(orderId, courier_);
        emit OrderStateChanged(orderId, OrderState.AwaitingReturnCourierBond);
    }

    /// @notice Locks the selected return courier's bond after buyer approval.
    function fundReturnCourierBond(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.AwaitingReturnCourierBond);
        if (msg.sender != order.returnCourier) revert Unauthorized();
        if (block.timestamp > order.returnCourierFundingDeadline) revert DeadlinePassed();

        uint256 bond = requiredCourierBond(order.price);
        if (bond > type(uint128).max) revert InvalidAmount();
        _pullPrincipalAndActionFee(msg.sender, bond);

        order.returnCourierBond = bond.toUint128();
        order.returnPickupDeadline = _futureTimestamp(returnPickupPeriod);
        order.state = OrderState.ReturnCourierAccepted;
        emit ReturnCourierAccepted(orderId, msg.sender, bond);
        emit OrderStateChanged(orderId, OrderState.ReturnCourierAccepted);
    }

    function confirmReturnPickup(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.ReturnCourierAccepted);
        if (block.timestamp > order.returnPickupDeadline) revert DeadlinePassed();

        uint8 roleBit = 0;
        if (msg.sender == order.buyer) roleBit = CONFIRMATION_FIRST_ROLE;
        else if (msg.sender == order.returnCourier) roleBit = CONFIRMATION_SECOND_ROLE;
        else revert Unauthorized();

        order.returnPickupConfirmations =
            _recordConfirmation(order.returnPickupConfirmations, roleBit);
        _collectActionFee(msg.sender);
        emit RoleConfirmed(orderId, ACTION_RETURN_PICKUP, msg.sender);

        if (order.returnPickupConfirmations == CONFIRMATION_COMPLETE) {
            order.returnDeliveryDeadline = _futureTimestamp(returnDeliveryPeriod);
            order.state = OrderState.ReturnInTransit;
            emit OrderStateChanged(orderId, OrderState.ReturnInTransit);
        }
    }

    function confirmReturnDelivery(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.ReturnInTransit);
        if (block.timestamp > order.returnDeliveryDeadline) revert DeadlinePassed();

        uint8 roleBit = 0;
        if (msg.sender == order.seller) roleBit = CONFIRMATION_FIRST_ROLE;
        else if (msg.sender == order.returnCourier) roleBit = CONFIRMATION_SECOND_ROLE;
        else revert Unauthorized();

        order.returnDeliveryConfirmations =
            _recordConfirmation(order.returnDeliveryConfirmations, roleBit);
        _collectActionFee(msg.sender);
        emit RoleConfirmed(orderId, ACTION_RETURN_DELIVERY, msg.sender);

        if (order.returnDeliveryConfirmations == CONFIRMATION_COMPLETE) {
            _finalizeReturn(orderId, order);
        }
    }

    /// @notice Finalizes a delivery after the buyer did not co-sign but the courier reported it.
    /// @dev This implements the protocol rule that the bonded courier's report wins after grace.
    function finalizeCourierReportedDelivery(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.InTransit);
        if ((order.deliveryConfirmations & CONFIRMATION_SECOND_ROLE) == 0) {
            revert InvalidConfiguration();
        }
        if (block.timestamp <= _courierResolutionAt(order)) revert DeadlineNotReached();
        _markDelivered(orderId, order);
    }

    /// @notice Finalizes a return after the seller did not co-sign but the courier reported it.
    /// @dev A timely courier report prevents a receiver from stealing the courier's bond by silence.
    function finalizeCourierReportedReturn(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.ReturnInTransit);
        if ((order.returnDeliveryConfirmations & CONFIRMATION_SECOND_ROLE) == 0) {
            revert InvalidConfiguration();
        }
        if (block.timestamp <= order.returnDeliveryDeadline) revert DeadlineNotReached();
        _finalizeReturn(orderId, order);
    }

    function finalizeInspection(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireState(order, OrderState.Delivered);
        if (block.timestamp <= order.inspectionEndsAt) revert DeadlineNotReached();

        _credit(orderId, order.seller, order.price);
        _credit(orderId, order.buyer, order.returnDeliveryFee);
        order.buyerEscrow = 0;
        order.state = OrderState.Completed;
        _products[order.productId].status = ProductStatus.Sold;
        emit ProductStatusChanged(order.productId, ProductStatus.Sold);
        emit OrderStateChanged(orderId, OrderState.Completed);
    }

    function expireOrderBeforePickup(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        if (
            order.state == OrderState.AwaitingCourier
                && block.timestamp > order.courierAcceptDeadline
        ) {
            _cancelBeforeCustody(orderId, order);
        } else if (
            order.state == OrderState.AwaitingCourierBond
                && block.timestamp > order.courierFundingDeadline
        ) {
            address failedCourier = order.courier;
            if (block.timestamp <= order.courierAcceptDeadline) {
                _resetCourierSelection(orderId, order, failedCourier);
            } else {
                _cancelBeforeCustody(orderId, order);
            }
        } else if (
            order.state == OrderState.AwaitingSellerBond
                && block.timestamp > order.sellerFundingDeadline
        ) {
            _cancelBeforeCustody(orderId, order);
        } else if (
            order.state == OrderState.ReadyForPickup && block.timestamp > order.pickupDeadline
        ) {
            _cancelBeforeCustody(orderId, order);
        } else {
            revert DeadlineNotReached();
        }
    }

    function expireUnmatchedReturn(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        if (
            order.state == OrderState.ReturnRequested
                && block.timestamp > order.returnAcceptDeadline
        ) {
            _completeFailedVoluntaryReturn(orderId, order);
        } else if (
            order.state == OrderState.AwaitingReturnCourierBond
                && block.timestamp > order.returnCourierFundingDeadline
        ) {
            _retryOrCompleteVoluntaryReturn(orderId, order);
        } else if (
            order.state == OrderState.ReturnCourierAccepted
                && block.timestamp > order.returnPickupDeadline
        ) {
            if (order.returnCourierBond != 0) {
                _credit(orderId, order.returnCourier, order.returnCourierBond);
                order.returnCourierBond = 0;
            }
            _retryOrCompleteVoluntaryReturn(orderId, order);
        } else {
            revert DeadlineNotReached();
        }
    }

    function declareCourierDefault(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        if (order.state == OrderState.InTransit) {
            if ((order.deliveryConfirmations & CONFIRMATION_SECOND_ROLE) != 0) {
                revert CourierAlreadyReportedDelivery();
            }
            if (block.timestamp <= _courierResolutionAt(order)) revert DeadlineNotReached();
            _settleCourierDefault(orderId, order, order.courierBond);
            order.courierBond = 0;
        } else if (order.state == OrderState.ReturnInTransit) {
            if ((order.returnDeliveryConfirmations & CONFIRMATION_SECOND_ROLE) != 0) {
                revert CourierAlreadyReportedDelivery();
            }
            if (block.timestamp <= order.returnDeliveryDeadline) revert DeadlineNotReached();
            uint128 activeBond;
            if (order.returnReason == ReturnReason.BuyerChoice) {
                activeBond = order.returnCourierBond;
                order.returnCourierBond = 0;
            } else {
                activeBond = order.courierBond;
                order.courierBond = 0;
            }
            _settleCourierDefault(orderId, order, activeBond);
        } else {
            revert InvalidState(OrderState.InTransit, order.state);
        }
    }

    function claim() external nonReentrant returns (uint256 netAmount) {
        return _claimTo(msg.sender);
    }

    function _claimTo(address account) private returns (uint256 netAmount) {
        uint256 grossAmount = claimable[account];
        if (grossAmount == 0) revert NothingToClaim();

        claimable[account] = 0;
        totalLiability -= grossAmount;

        uint256 fee = Math.min(actionFee, grossAmount);
        netAmount = grossAmount - fee;
        accruedFees += fee;
        if (netAmount != 0) paymentToken.safeTransfer(account, netAmount);

        if (paymentToken.balanceOf(address(this)) < totalLiability + accruedFees) {
            revert Insolvent();
        }
        emit Claimed(account, grossAmount, fee, netAmount);
    }

    function _deliveryConfirmationCutoff(Order storage order) private view returns (uint256) {
        if (order.absentReportedAt == 0) return order.deliveryDeadline;
        return uint256(order.absentReportedAt) + buyerAbsentGracePeriod;
    }

    function _courierResolutionAt(Order storage order) private view returns (uint256 timestamp) {
        timestamp = uint256(order.deliveryDeadline) + buyerAbsentGracePeriod;
        if (order.absentReportedAt != 0) timestamp += buyerAbsentGracePeriod;
    }

    function _futureTimestamp(uint64 duration) private view returns (uint64) {
        uint256 timestamp = block.timestamp + duration;
        if (timestamp > type(uint64).max) revert InvalidDeadline();
        return timestamp.toUint64();
    }

    function _requireState(Order storage order, OrderState expected) private view {
        if (order.state != expected) revert InvalidState(expected, order.state);
    }

    function _recordConfirmation(uint8 current, uint8 roleBit) private pure returns (uint8) {
        if ((current & roleBit) != 0) revert AlreadyConfirmed();
        return current | roleBit;
    }

    function _markDelivered(uint256 orderId, Order storage order) private {
        uint256 forwardFee = order.forwardDeliveryFee;
        uint256 courierRelease = forwardFee + order.courierBond;
        uint256 sellerRelease = order.sellerBond;

        order.buyerEscrow -= order.forwardDeliveryFee;
        order.courierBond = 0;
        order.sellerBond = 0;
        order.deliveredAt = uint64(block.timestamp);
        order.inspectionEndsAt = _futureTimestamp(inspectionPeriod);
        order.state = OrderState.Delivered;

        _credit(orderId, order.courier, courierRelease);
        _credit(orderId, order.seller, sellerRelease);
        emit OrderStateChanged(orderId, OrderState.Delivered);
    }

    function _finalizeReturn(uint256 orderId, Order storage order) private {
        if (order.returnReason == ReturnReason.BuyerChoice) {
            _credit(orderId, order.buyer, order.price);
            _credit(
                orderId,
                order.returnCourier,
                uint256(order.returnDeliveryFee) + order.returnCourierBond
            );
            order.buyerEscrow = 0;
            order.returnCourierBond = 0;
        } else if (order.returnReason == ReturnReason.SellerFault) {
            _credit(orderId, order.buyer, order.buyerEscrow);
            _credit(orderId, order.returnCourier, uint256(order.sellerBond) + order.courierBond);
            order.buyerEscrow = 0;
            order.sellerBond = 0;
            order.courierBond = 0;
        } else if (order.returnReason == ReturnReason.BuyerAbsent) {
            _credit(orderId, order.buyer, order.price);
            _credit(
                orderId,
                order.returnCourier,
                uint256(order.forwardDeliveryFee) + order.returnDeliveryFee + order.courierBond
            );
            _credit(orderId, order.seller, order.sellerBond);
            order.buyerEscrow = 0;
            order.sellerBond = 0;
            order.courierBond = 0;
        } else {
            revert InvalidConfiguration();
        }

        order.state = OrderState.Refunded;
        _products[order.productId].status = ProductStatus.Inactive;
        emit ProductStatusChanged(order.productId, ProductStatus.Inactive);
        emit OrderStateChanged(orderId, OrderState.Refunded);
    }

    function _cancelBeforeCustody(uint256 orderId, Order storage order) private {
        if (order.buyerEscrow != 0) {
            _credit(orderId, order.buyer, order.buyerEscrow);
            order.buyerEscrow = 0;
        }
        if (order.sellerBond != 0) {
            _credit(orderId, order.seller, order.sellerBond);
            order.sellerBond = 0;
        }
        if (order.courierBond != 0) {
            _credit(orderId, order.courier, order.courierBond);
            order.courierBond = 0;
        }

        order.state = OrderState.Cancelled;
        _products[order.productId].status = ProductStatus.Active;
        emit ProductStatusChanged(order.productId, ProductStatus.Active);
        emit OrderStateChanged(orderId, OrderState.Cancelled);
    }

    function _resetCourierSelection(uint256 orderId, Order storage order, address failedCourier)
        private
    {
        order.courier = address(0);
        order.courierFundingDeadline = 0;
        order.selectedPickupPeriod = 0;
        order.selectedDeliveryPeriod = 0;
        order.state = OrderState.AwaitingCourier;
        emit CourierSelectionReset(orderId, failedCourier);
        emit OrderStateChanged(orderId, OrderState.AwaitingCourier);
    }

    function _retryOrCompleteVoluntaryReturn(uint256 orderId, Order storage order) private {
        address failedCourier = order.returnCourier;
        order.returnCourier = address(0);
        order.returnCourierFundingDeadline = 0;
        order.returnPickupDeadline = 0;
        order.returnPickupConfirmations = 0;

        if (block.timestamp < order.returnProcessDeadline) {
            uint256 nextDeadline = block.timestamp + returnAcceptPeriod;
            if (nextDeadline > order.returnProcessDeadline) {
                nextDeadline = order.returnProcessDeadline;
            }
            order.returnAcceptDeadline = nextDeadline.toUint64();
            order.state = OrderState.ReturnRequested;
            emit ReturnCourierSelectionReset(orderId, failedCourier);
            emit OrderStateChanged(orderId, OrderState.ReturnRequested);
        } else {
            _completeFailedVoluntaryReturn(orderId, order);
        }
    }

    function _completeFailedVoluntaryReturn(uint256 orderId, Order storage order) private {
        _credit(orderId, order.seller, order.price);
        _credit(orderId, order.buyer, order.returnDeliveryFee);
        order.buyerEscrow = 0;
        order.state = OrderState.Completed;
        _products[order.productId].status = ProductStatus.Sold;
        emit ProductStatusChanged(order.productId, ProductStatus.Sold);
        emit OrderStateChanged(orderId, OrderState.Completed);
    }

    function _settleCourierDefault(uint256 orderId, Order storage order, uint128 activeBond)
        private
    {
        if (activeBond == 0) revert InvalidConfiguration();
        _credit(orderId, order.buyer, order.buyerEscrow);
        _credit(orderId, order.seller, uint256(order.sellerBond) + activeBond);
        order.buyerEscrow = 0;
        order.sellerBond = 0;
        order.state = OrderState.CourierDefaulted;
        _products[order.productId].status = ProductStatus.Lost;
        emit ProductStatusChanged(order.productId, ProductStatus.Lost);
        emit OrderStateChanged(orderId, OrderState.CourierDefaulted);
    }

    function _credit(uint256 orderId, address account, uint256 amount) private {
        if (amount == 0) return;
        claimable[account] += amount;
        emit FundsCredited(orderId, account, amount);
    }

    function _pullPrincipalAndActionFee(address payer, uint256 principal) private {
        _pullPrincipalAndFee(payer, principal, actionFee, keccak256("ACTION"));
    }

    function _pullPrincipalAndFee(address payer, uint256 principal, uint256 fee, bytes32 feeType)
        private
    {
        _pullExact(payer, principal);
        totalLiability += principal;
        _collectFee(payer, fee, feeType);
    }

    function _collectActionFee(address payer) private {
        _collectFee(payer, actionFee, keccak256("ACTION"));
    }

    function _collectCourierOfferFee(address payer) private {
        _collectFee(payer, COURIER_OFFER_FEE, keccak256("COURIER_OFFER"));
    }

    function _collectFee(address payer, uint256 fee, bytes32 feeType) private {
        if (fee == 0) return;
        _pullExact(payer, fee);
        accruedFees += fee;
        emit FeeCollected(payer, fee, feeType);
    }

    function _pullExact(address payer, uint256 amount) private {
        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(payer, address(this), amount);
        if (paymentToken.balanceOf(address(this)) - beforeBalance != amount) {
            revert UnsupportedTransferBehavior();
        }
    }
}
