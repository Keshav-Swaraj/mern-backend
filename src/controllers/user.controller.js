import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.models.js";
import { uplloadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";

const generateAccessAndRefreshToken = async(userId)=>{
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();
        
        user.refreshToken = refreshToken;
        await user.save({validateBeforeSave: false});
        
        return {accessToken, refreshToken};
        
    } catch (error) {
        throw new ApiError(500, "something went wrong while generating refresh and access tokens");
    }
}

const registerUser = asyncHandler( async(req, res) => {
    
    //get user details from frontend
    const {fullname, email, username, password} = req.body;

    //validation - not empty
    if(
        [fullname, email, username, password].some((field) => field?.trim() === "")
    ){
        throw new ApiError(400, "All fields are required");

    }

    //check if user already exist: username, email
    const existedUser = await User.findOne({
        $or: [ { username }, { email }]
    })
    if(existedUser){
        throw new ApiError(409, "User already exist");
    }

    //check for images, check for avatar
    const avatarLocalPath = req.files?.avatar[0]?.path;
    
    let coverImageLocalPath;
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path
    }

    if(!avatarLocalPath){
        throw new ApiError(400, "Avatar is required");
    }

    //upload them to cloudinary, avatar
    const avatar = await uplloadOnCloudinary(avatarLocalPath);
    const coverImage = await uplloadOnCloudinary(coverImageLocalPath);

    if(!avatar){
        throw new ApiError(400, "Avatar upload failed");
    }

    //create user object - create entry in db
    const user = await User.create({
        fullname: fullname,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        username: username.toLowerCase(),
        email,
        password,
    })

    //remove password, refresh token field from response
    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    //check for user creation
    if(!createdUser){
        throw new ApiError(500, "something went wrong while registering user");
    }

    //return response
    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered successfully")
    )
})

const loginUser = asyncHandler( async(req, res) => {
    //req body => data
    const {email, username, password} = req.body;

    //username or email
    if(!username && !email){
        throw new ApiError(400, "Username or email is required");
    }

    //find the user
    const user = await User.findOne({
        $or: [ { username }, { email }]
    })

    if(!user){
        throw new ApiError(404, "User not found");
    }

    //password check
    const isPasswordValid = await user.isPasswordCorrect(password);

    if(!isPasswordValid){
        throw new ApiError(401, "Password is incorrect");
    }

    //generate access token and refresh token
    const {accessToken, refreshToken} = await generateAccessAndRefreshToken(user._id);

    const loggedInUser = await User.findById(user._id).
    select("-password -refreshToken");

    //send cookie
    const options = {
        httpOnly: true,
        secure: true,
    }

    return res.status(200).
    cookie("accessToken",accessToken,options).
    cookie("refreshToken",refreshToken,options).
    json(
        new ApiResponse(200, {
            user: loggedInUser,accessToken, refreshToken
        }, "User logged in successfully")
    )

})

const logoutUser = asyncHandler(async(req, res)=>{
    await User.findOneAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined
            }
        },
        {
            new: true
        }
    )

    const options = {
        httpOnly: true,
        secure: true,
    }

    return res.status(200).
    clearCookie("accessToken",options).
    clearCookie("refreshToken",options).
    json(
        new ApiResponse(200, {}, "User logged out successfully")
    )
})

const refreshAccessToken = asyncHandler( async(req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if(!incomingRefreshToken){
        throw new ApiError(401, "Refresh Token is required");
    }

    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);
    
        const user = await User.findById(decodedToken?._id);
    
        if(!user){
            throw new ApiError(401, "Invlaid Refresh Token");
        }
    
        if(incomingRefreshToken !== user.refreshToken){
            throw new ApiError(401, "Refresh Token is expired or used");
        }
    
        const {accessToken, NewRefreshToken} = await generateAccessAndRefreshToken(user._id);
    
        const options = {
            httpOnly: true,
            secure: true,
        }
    
        return res.status(200).
        cookie("accessToken",accessToken,options).
        cookie("refreshToken",NewRefreshToken,options).
        json(
            new ApiResponse(200, {
                accessToken, refreshToken: NewRefreshToken
            }, "Access token refreshed successfully")
        )
    } catch (error) {
        throw new ApiError(401, error?.message || "Invlaid Refresh Token");
    }

})

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken
}