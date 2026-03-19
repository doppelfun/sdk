
/* 
    Timestamp to avoid Date.now() calls in hot paths.

    Date.now() is relatively cheap but still:
    - Creates a number allocation
    - Requires system call overhead
    - Adds up when called thousands of times per tick

    Update once per tick, read many times.
*/
export function getNow(): number {
    return Date.now();
}
