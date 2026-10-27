-- Marketplace Integration Tables Migration
-- Run this SQL directly in MySQL to create the marketplace tables
-- Database: uksoccershop

-- ============================================
-- Table: jsa_MarketplaceListing
-- ============================================
CREATE TABLE IF NOT EXISTS `jsa_MarketplaceListing` (
  `id` VARCHAR(25) NOT NULL,
  `storeId` INT NOT NULL,
  `marketplaceName` VARCHAR(191) NOT NULL,
  `ukssSku` VARCHAR(191) NOT NULL,
  `ukssProductId` INT NULL,
  `ukssQuantity` INT NOT NULL DEFAULT 0,
  `ukssPrice` DECIMAL(10, 2) NOT NULL DEFAULT 0,
  `externalSkuId` VARCHAR(191) NULL,
  `externalProductId` VARCHAR(191) NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `listedAt` DATETIME(3) NULL,
  `delistedAt` DATETIME(3) NULL,
  `syncAllowed` BOOLEAN NOT NULL DEFAULT true,
  `lastSyncStatus` ENUM('PENDING', 'SYNCING', 'SYNCED', 'FAILED') NULL,
  `lastSyncedAt` DATETIME(3) NULL,
  `retryCount` INT NOT NULL DEFAULT 0,
  `lastSyncError` VARCHAR(500) NULL,
  `lastSyncedQuantity` INT NULL,
  `lastSyncedPrice` DECIMAL(10, 2) NULL,
  `priority` INT NOT NULL DEFAULT 0,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `jsa_MarketplaceListing_storeId_ukssSku_key` (`storeId`, `ukssSku`),
  INDEX `jsa_MarketplaceListing_storeId_isActive_idx` (`storeId`, `isActive`),
  INDEX `jsa_MarketplaceListing_storeId_listedAt_idx` (`storeId`, `listedAt`),
  INDEX `jsa_MarketplaceListing_storeId_lastSyncStatus_retryCount_idx` (`storeId`, `lastSyncStatus`, `retryCount`),
  INDEX `jsa_MarketplaceListing_storeId_lastSyncedAt_idx` (`storeId`, `lastSyncedAt`),
  INDEX `jsa_MarketplaceListing_storeId_priority_idx` (`storeId`, `priority`),
  INDEX `jsa_MarketplaceListing_storeId_ukssQuantity_lastSyncedQuantity_idx` (`storeId`, `ukssQuantity`, `lastSyncedQuantity`),
  INDEX `jsa_MarketplaceListing_externalSkuId_idx` (`externalSkuId`),
  INDEX `jsa_MarketplaceListing_storeId_syncAllowed_idx` (`storeId`, `syncAllowed`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Table: jsa_MarketplaceSyncHistory
-- ============================================
CREATE TABLE IF NOT EXISTS `jsa_MarketplaceSyncHistory` (
  `id` VARCHAR(25) NOT NULL,
  `storeId` INT NOT NULL,
  `marketplaceName` VARCHAR(191) NOT NULL,
  `operation` VARCHAR(191) NOT NULL,
  `correlationId` VARCHAR(191) NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  `durationMs` INT NULL,
  `status` ENUM('RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'RUNNING',
  `totalItems` INT NOT NULL DEFAULT 0,
  `newItemsListed` INT NOT NULL DEFAULT 0,
  `itemsUpdated` INT NOT NULL DEFAULT 0,
  `itemsFailed` INT NOT NULL DEFAULT 0,
  `errorSummary` VARCHAR(500) NULL,
  `errorDetails` JSON NULL,
  `triggeredBy` VARCHAR(191) NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `jsa_MarketplaceSyncHistory_storeId_operation_idx` (`storeId`, `operation`),
  INDEX `jsa_MarketplaceSyncHistory_storeId_startedAt_idx` (`storeId`, `startedAt`),
  INDEX `jsa_MarketplaceSyncHistory_status_idx` (`status`),
  INDEX `jsa_MarketplaceSyncHistory_correlationId_idx` (`correlationId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Verify tables were created
-- ============================================
SELECT 'Tables created successfully!' AS result;
SHOW TABLES LIKE 'jsa_Marketplace%';
