/**
 * AppError
 * A normal Error that also carries an HTTP status code.
 * Example: throw new AppError('Only the host can record', 403)
 */
export class AppError extends Error{
    statusCode:number

    constructor(message:string,statusCode:number=400){
        super(message)
        this.statusCode=statusCode
        this.name='AppError'
    }


} 