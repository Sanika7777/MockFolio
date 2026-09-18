CREATE DATABASE sanika;
USE sanika;

--@block
CREATE TABLE employee(
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name TEXT NOT NULL,
    superid INT UNSIGNED AUTO_INCREMENT,
    salary DECIMAL(10,2) NOT NULL, 
    bdate DATE NOT NULL,
    dno INT UNSIGNED
)
--@block