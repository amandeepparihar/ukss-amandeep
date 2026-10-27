-- Ticket ID: 164781 - Single Sign-On between Node.js and PHP applications
-- This migration creates the shared admin session table for cross-app authentication
-- Run this SQL on the shared MySQL database

-- Create the shared admin session table
CREATE TABLE IF NOT EXISTS `jsa_SharedAdminSession` (
    `id` VARCHAR(30) NOT NULL,
    `token` VARCHAR(128) NOT NULL,
    `userEmail` VARCHAR(255) NOT NULL,
    `nodeUserId` VARCHAR(30) NULL,
    `phpUserId` INT NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` TEXT NULL,
    `expiresAt` DATETIME NOT NULL,
    `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `lastActiveAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `jsa_SharedAdminSession_token_key` (`token`),
    KEY `jsa_SharedAdminSession_token_idx` (`token`),
    KEY `jsa_SharedAdminSession_userEmail_idx` (`userEmail`),
    KEY `jsa_SharedAdminSession_nodeUserId_idx` (`nodeUserId`),
    KEY `jsa_SharedAdminSession_phpUserId_idx` (`phpUserId`),
    KEY `jsa_SharedAdminSession_expiresAt_idx` (`expiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add comment to table for documentation
ALTER TABLE `jsa_SharedAdminSession` COMMENT = 'Ticket ID: 164781 - Cross-application shared admin sessions for SSO between Node.js and PHP applications';
