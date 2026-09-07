"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form";
import { z } from "zod"
import InputField from "../InputField";
import Image from "next/image";

/* Schema for Form validation */
const schema = z.object({
  username: z
  .string()
  .min(3, { message: 'Username must be at least 3 characters long!' })
  .max(20, { message: 'Username must be at most 20 characters long!' }),

  email: z.email({message:"Invalid email address!"}),

  password: z.string().min(8, { message: 'Password must be at least 8 characters long!' }),

  firstName: z.string().min(1, { message: 'First name is required!' }),

  lastName: z.string().min(1, { message: 'Last name is required!' }),

  phone: z.string().min(1, { message: 'Phone is required!' }),

  address: z.string().min(1, { message: 'Address is required!' }),

  bloodType: z.string().min(1, { message: 'Blood Type is required!' }),

  birthday: z.date( { message: 'Birthday is required!' } ),

  sex: z.enum( [ "male", "female" ], {message: "Sex is required!"}),

  img: z.instanceof( File,{ message: "Image is required!" } ),

  
});

{ /* ZOD */ }
type Inputs = z.infer<typeof schema>


const StudentForm = ( { type, data }: { type: "create" | "update"; data?: any; }) => {

  { /* ZOD */ }
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Inputs> ({
    resolver: zodResolver(schema),
  });


  const onSubmit = handleSubmit( (data) => {
    console.log(data);
  } )


  return (
    
     /* FORM */ 
    <form className=" flex flex-col gap-8 " onSubmit={onSubmit} >

      { /* CONDITION FOR FORM HEADING */ }
      { type === "create" ? < h1 className="text-xl font-semibold">Create A New Student</h1> : < h1 className="text-xl font-semibold">Update Student</h1> }

      { /* FORM MODAL LABEL 1 */ }
      <span className="text-xs text-gray-400 font-medium">
        Authentication Information
      </span>

      { /* AUTHENTICATION INPUTS MAIN CONTAINER 1 */ }
      <div className="flex justify-between flex-wrap gap-4 ">

        { /* AUTHENTICATION INFROMATION INPUTS */ }
        <InputField label="Username" name="username" defaultValue= {data?.username} register={register} error={errors.username} />

        <InputField label="Email" name="email" type="email" defaultValue= {data?.email} register={register} error={errors.email} />

        <InputField label="Password" name="password" type="password" defaultValue= {data?.password} register={register} error={errors.password} />

      </div>
      
      { /* FORM MODAL LABEL 2 */ }
      <span className="text-xs text-gray-400 font-medium">
        Personal Information
      </span>

      { /* PERSONAL INFO INPUTS MAIN CONTAINER 2 */ }
      <div className="flex justify-between flex-wrap gap-4">

        { /* PERSONAL INFO INPUTS */ }
        <InputField label="First Name" name="firstName" defaultValue= {data?.firstName} register={register} error={errors.firstName} />

        <InputField label="Last Name" name="lastName" defaultValue= {data?.lastName} register={register} error={errors.lastName} />

       <InputField label="Phone" name="phone" defaultValue= {data?.phone} register={register} error={errors.phone} />

        <InputField label="Address" name="address" defaultValue= {data?.address} register={register} error={errors.address} />

        <InputField label="Blood Type" name="bloodType" defaultValue= {data?.bloodType} register={register} error={errors.bloodType} />

        <InputField label="Birthday" name="birthday" defaultValue= {data?.birthday} register={register} error={errors.birthday} type="date" />

      

        { /* SEX OPTIONS MAIN CONTAINER */ }
        <div className=" flex flex-col gap-2 w-full md:w-1/4">
          
          { /* LABEL FOR SEX OPTION */ }
          <label className=" text-xs text-gray-500 ">Sex</label>

          { /* SEX OPTIONS */ }
          <select className=" ring-[1.5px] ring-gray-300 p-2 rounded-md text-sm w-full" {...register("sex")} defaultValue={data?.sex} >
          <option value="male">Male</option>
          <option value="female">Female</option>
          </select>

          { /* ERORR MESSAGE FOR SEX */ }
          {errors.sex?.message && <p className=" text-xs text-red-400" >{errors.sex.message.toString() }</p>}

        </div>

        { /* UPLOAD IMG MAIN CONTAINER */ }
        <div className=" flex flex-col gap-2 w-full md:w-1/4 justify-center ">

          { /* LABEL FOR UPLOAD IMG  */ }
          <label className=" text-xs text-gray-500 flex items-center gap-2 cursor-pointer " htmlFor="img" >
            <Image src="/upload.png" alt="" width={28} height={28} />

            <span>Upload a photo</span>
          </label>

          { /* INPUT FOR FILE UPLOAD */ }
          <input type="file" {...register("img")} className=" hidden" id="img" />

         { /* ERROR MESSAGE FOR IMG UPLOAD */ }
         {errors.img?.message && <p className=" text-xs text-red-400" >{errors.img.message.toString() }</p>}

        </div>

      </div>

      { /* UPDATE AND CREATE BUTTON */ }
      <button className="bg-blue-400 text-white p-2 rounded-md">
        { type === "create" ? "Create" : "Update" }
      </button>

    </form>

  )
}

export default StudentForm