# Local web server for the CRM: Apache + PHP 8.2 with the MySQL driver,
# configured like Hostinger (.htaccess files are honoured).
FROM php:8.2-apache
RUN docker-php-ext-install pdo_mysql \
 && a2enmod rewrite headers expires deflate \
 && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf
