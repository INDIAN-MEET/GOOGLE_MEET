/**  
 * * @description AppError class to handle errors
 * * @param {string} message
 * * @param {number} statusCode
 */
class AppError extends Error {
    statusCode: number

    constructor(message: string, statusCode: number = 400) {
        super(message)
        this.statusCode = statusCode
        Object.setPrototypeOf(this, AppError.prototype);
    }

}

export default AppError